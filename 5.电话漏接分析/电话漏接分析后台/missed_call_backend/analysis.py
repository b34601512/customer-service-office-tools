"""该文件只负责把通话记录计算成报告结果，不处理接口、浏览器或磁盘缓存。"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

from .normalizers import first_value, format_seconds, normalize_agent_extension, normalize_phone, parse_datetime, parse_duration_seconds
from .state_store import load_agent_mapping, load_complaint_config, map_agent_name


def build_loss_records(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """抽取呼损关键字段，缺少号码或时间的行直接标记为无效数据。"""
    records = []
    for row in rows:
        call_time = parse_datetime(row.get("来电时间"))
        phone = normalize_phone(row.get("来电号码"))
        if not call_time or not phone:
            continue

        ivr_seconds = parse_duration_seconds(row.get("IVR停留"))
        queue_seconds = parse_duration_seconds(row.get("排队停留"))
        records.append(
            {
                "phone": phone,
                "called_number": normalize_phone(row.get("DID号码")),
                "called_number_text": str(row.get("DID号码") or "").strip(),
                "loss_time": call_time,
                "loss_time_text": call_time.strftime("%Y-%m-%d %H:%M:%S"),
                "ivr_seconds": ivr_seconds,
                "queue_seconds": queue_seconds,
                "wait_seconds": ivr_seconds + queue_seconds,
                "lost_stage": str(row.get("丢失位置") or "未知").strip() or "未知",
                "city": str(row.get("归属地") or "未知").strip() or "未知",
                "did": str(row.get("DID号码") or "").strip(),
                "queue": str(row.get("队列号") or "").strip(),
            }
        )
    return records


def build_inbound_records(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """抽取成功呼入关键字段，只把有通话时长的记录当作联系成功。"""
    records = []
    for row in rows:
        inbound_time = parse_datetime(row.get("呼入时间"))
        phone = normalize_phone(row.get("主叫号码"))
        talk_seconds = parse_duration_seconds(row.get("通话时长"))
        if not inbound_time or not phone:
            continue
        ivr_seconds = parse_duration_seconds(row.get("IVR时长"))
        queue_seconds = parse_duration_seconds(row.get("排队时长"))
        records.append(
            {
                "phone": phone,
                "called_number": normalize_phone(row.get("DID号码")),
                "called_number_text": str(row.get("DID号码") or "").strip(),
                "inbound_time": inbound_time,
                "inbound_time_text": inbound_time.strftime("%Y-%m-%d %H:%M:%S"),
                "talk_seconds": talk_seconds,
                "ivr_seconds": ivr_seconds,
                "queue_seconds": queue_seconds,
                "wait_seconds": ivr_seconds + queue_seconds,
                "agent": str(row.get("座席姓名") or "").strip(),
                "agent_extension": normalize_agent_extension(row.get("座席分机")),
                "city": str(row.get("归属地") or "未知").strip() or "未知",
            }
        )
    return records


def build_outbound_records(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """抽取呼出关键字段，呼出表头可能随系统版本变化，所以按候选列兼容。"""
    records = []
    for row in rows:
        outbound_time = parse_datetime(first_value(row, ["呼出时间", "拨打时间", "外呼时间", "开始时间", "通话时间"]))
        phone = normalize_phone(first_value(row, ["被叫号码", "客户号码", "电话号码", "外呼号码", "主叫号码"]))
        talk_seconds = parse_duration_seconds(first_value(row, ["通话时长", "接通时长", "通话时间", "呼出时长"]))
        if not outbound_time or not phone:
            continue
        records.append(
            {
                "phone": phone,
                "outbound_time": outbound_time,
                "outbound_time_text": outbound_time.strftime("%Y-%m-%d %H:%M:%S"),
                "talk_seconds": talk_seconds,
                "agent": str(first_value(row, ["座席姓名", "坐席姓名", "客服", "处理人"]) or "").strip(),
                "agent_extension": normalize_agent_extension(first_value(row, ["座席分机", "坐席分机", "分机", "坐席号", "座席号"])),
                "city": str(first_value(row, ["归属地", "地区", "城市"]) or "未知").strip() or "未知",
            }
        )
    return records


def calculate_priority(loss_count: int, total_wait_seconds: int, queue_loss_count: int, latest_loss_time: datetime) -> tuple[int, str]:
    """用少量可解释指标给回访优先级打分，而不是制造黑箱模型。"""
    score = 0
    score += min(loss_count * 25, 100)
    score += min(total_wait_seconds // 10, 50)
    score += queue_loss_count * 15
    if (datetime.now() - latest_loss_time).days <= 2:
        score += 20

    if score >= 110:
        return score, "高"
    if score >= 70:
        return score, "中"
    return score, "低"


def build_daily_trends(
    loss_records: list[dict[str, Any]],
    inbound_records: list[dict[str, Any]],
    outbound_records: list[dict[str, Any]],
) -> dict[str, Any]:
    """按自然日汇总呼入、呼出、呼损趋势，供各展示层逐日读取。"""
    loss_daily = Counter(record["loss_time"].strftime("%Y-%m-%d") for record in loss_records)
    ivr_loss_daily = Counter(record["loss_time"].strftime("%Y-%m-%d") for record in loss_records if "IVR" in record["lost_stage"].upper())
    queue_loss_daily = Counter(record["loss_time"].strftime("%Y-%m-%d") for record in loss_records if "排队" in record["lost_stage"])
    inbound_daily = Counter(record["inbound_time"].strftime("%Y-%m-%d") for record in inbound_records)
    outbound_daily = Counter(record["outbound_time"].strftime("%Y-%m-%d") for record in outbound_records)
    successful_inbound_daily = Counter(
        record["inbound_time"].strftime("%Y-%m-%d") for record in inbound_records if record["talk_seconds"] > 0
    )
    all_days = sorted(set(loss_daily) | set(inbound_daily) | set(outbound_daily))
    rows = []
    for day in all_days:
        inbound_count = inbound_daily[day]
        successful_inbound_count = successful_inbound_daily[day]
        loss_count = loss_daily[day]
        total_contact_count = inbound_count + loss_count
        rows.append(
            {
                "date": day,
                "inboundCount": inbound_count,
                "successfulInboundCount": successful_inbound_count,
                "outboundCount": outbound_daily[day],
                "lossCount": loss_count,
                "ivrLossCount": ivr_loss_daily[day],
                "queueLossCount": queue_loss_daily[day],
                "totalContactCount": total_contact_count,
                "lossRate": round(loss_count / total_contact_count * 100, 1) if total_contact_count else 0,
                "successRate": round(successful_inbound_count / inbound_count * 100, 1) if inbound_count else 0,
            }
        )
    peak_loss_day = max(rows, key=lambda item: item["lossCount"], default=None)
    peak_inbound_day = max(rows, key=lambda item: item["inboundCount"], default=None)
    return {
        "granularity": "day",
        "hasOutboundData": bool(outbound_records),
        "rows": rows,
        "summary": {
            "dayCount": len(rows),
            "peakLossDate": peak_loss_day["date"] if peak_loss_day and peak_loss_day["lossCount"] else "无",
            "peakLossCount": peak_loss_day["lossCount"] if peak_loss_day else 0,
            "peakInboundDate": peak_inbound_day["date"] if peak_inbound_day and peak_inbound_day["inboundCount"] else "无",
            "peakInboundCount": peak_inbound_day["inboundCount"] if peak_inbound_day else 0,
            "averageLossRate": round(
                sum(item["lossCount"] for item in rows) / max(sum(item["totalContactCount"] for item in rows), 1) * 100,
                1,
            )
            if rows
            else 0,
        },
    }


def aggregate_monthly_summary(daily_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """把每日趋势行按自然月聚合，供各部门共用月总览口径。

    口径与时间段总览一致：呼入、呼出分别是各自明细表的条数（呼入不含呼损），
    合计 = 呼入 + 呼出；呼损单独保留并在界面标注“另计”，不并入呼入。
    """
    months: dict[str, dict[str, Any]] = {}
    for row in daily_rows:
        day = str(row.get("date") or "")
        month = day[:7]
        if len(month) != 7:
            continue
        item = months.setdefault(
            month,
            {
                "month": month,
                "inboundCount": 0,
                "outboundCount": 0,
                "lossCount": 0,
                "days": [],
            },
        )
        item["inboundCount"] += int(float(row.get("inboundCount") or 0))
        item["outboundCount"] += int(float(row.get("outboundCount") or 0))
        item["lossCount"] += int(float(row.get("lossCount") or 0))
        item["days"].append(row)
    for item in months.values():
        item["totalCount"] = item["inboundCount"] + item["outboundCount"]
    return sorted(months.values(), key=lambda item: item["month"], reverse=True)


def agent_summary_bucket(record: dict[str, Any], mappings: dict[str, str]) -> tuple[str, str, str, str]:
    """把一条通话记录归入稳定座席分组，未映射分机也不能互相合并。"""
    raw_agent_name = str(record.get("agent") or "").strip() or "未填写"
    agent_extension = normalize_agent_extension(record.get("agent_extension"))
    mapped_agent_name = map_agent_name(agent_extension, raw_agent_name, mappings)
    group_key = mapped_agent_name if agent_extension in mappings else f"{agent_extension or '无分机'}|{raw_agent_name}"
    return group_key, mapped_agent_name, agent_extension, raw_agent_name


def _new_agent_group(mapped_agent_name: str) -> dict[str, Any]:
    """呼入/呼出两轮循环共用的分组初始结构，字段漂移会在汇总输出阶段暴露。"""
    return {
        "agentName": mapped_agent_name,
        "extensions": set(),
        "rawNames": set(),
        "inboundCount": 0,
        "successfulInboundCount": 0,
        "inboundTalkSeconds": 0,
        "outboundCount": 0,
        "successfulOutboundCount": 0,
        "outboundTalkSeconds": 0,
    }


def build_agent_summary(
    inbound_records: list[dict[str, Any]],
    outbound_records: list[dict[str, Any]],
    mappings: dict[str, str],
) -> list[dict[str, Any]]:
    """按坐席号映射后的当前姓名汇总呼入、呼出和整体工作量。"""
    grouped: dict[str, dict[str, Any]] = {}
    for record in inbound_records:
        group_key, mapped_agent_name, agent_extension, raw_agent_name = agent_summary_bucket(record, mappings)
        item = grouped.setdefault(group_key, _new_agent_group(mapped_agent_name))
        if agent_extension:
            item["extensions"].add(agent_extension)
        item["rawNames"].add(raw_agent_name)
        item["inboundCount"] += 1
        if record["talk_seconds"] > 0:
            item["successfulInboundCount"] += 1
            item["inboundTalkSeconds"] += record["talk_seconds"]

    for record in outbound_records:
        group_key, mapped_agent_name, agent_extension, raw_agent_name = agent_summary_bucket(record, mappings)
        item = grouped.setdefault(group_key, _new_agent_group(mapped_agent_name))
        if agent_extension:
            item["extensions"].add(agent_extension)
        item["rawNames"].add(raw_agent_name)
        item["outboundCount"] += 1
        if record["talk_seconds"] > 0:
            item["successfulOutboundCount"] += 1
            item["outboundTalkSeconds"] += record["talk_seconds"]

    output = []
    for item in grouped.values():
        inbound_count = item["inboundCount"]
        outbound_count = item["outboundCount"]
        total_contact_count = inbound_count + outbound_count
        successful_contact_count = item["successfulInboundCount"] + item["successfulOutboundCount"]
        total_talk_seconds = item["inboundTalkSeconds"] + item["outboundTalkSeconds"]
        output.append(
            {
                "agentName": item["agentName"],
                "extensions": sorted(item["extensions"]),
                "rawNames": sorted(item["rawNames"]),
                "inboundCount": inbound_count,
                "successfulInboundCount": item["successfulInboundCount"],
                "inboundTalkSeconds": item["inboundTalkSeconds"],
                "inboundTalkText": format_seconds(item["inboundTalkSeconds"]),
                "averageInboundTalkText": format_seconds(round(item["inboundTalkSeconds"] / max(item["successfulInboundCount"], 1))),
                "inboundSuccessRate": round(item["successfulInboundCount"] / inbound_count * 100, 1) if inbound_count else 0,
                "outboundCount": outbound_count,
                "successfulOutboundCount": item["successfulOutboundCount"],
                "outboundTalkSeconds": item["outboundTalkSeconds"],
                "outboundTalkText": format_seconds(item["outboundTalkSeconds"]),
                "averageOutboundTalkText": format_seconds(round(item["outboundTalkSeconds"] / max(item["successfulOutboundCount"], 1))),
                "outboundSuccessRate": round(item["successfulOutboundCount"] / outbound_count * 100, 1) if outbound_count else 0,
                "totalContactCount": total_contact_count,
                "successfulContactCount": successful_contact_count,
                "totalTalkSeconds": total_talk_seconds,
                "totalTalkText": format_seconds(total_talk_seconds),
                "averageTalkText": format_seconds(round(total_talk_seconds / max(successful_contact_count, 1))),
                "successRate": round(successful_contact_count / total_contact_count * 100, 1) if total_contact_count else 0,
            }
        )
    return sorted(output, key=lambda item: (item["totalContactCount"], item["totalTalkSeconds"]), reverse=True)


def build_agent_time_range(
    inbound_records: list[dict[str, Any]],
    outbound_records: list[dict[str, Any]],
) -> dict[str, str]:
    """汇总客服统计使用的呼入和呼出原始记录时间范围，避免前端猜测口径。"""
    inbound_times = [record["inbound_time"] for record in inbound_records]
    outbound_times = [record["outbound_time"] for record in outbound_records]
    all_times = inbound_times + outbound_times

    def format_range(times: list[datetime]) -> str:
        """把一组时间转成前端可直接展示的起止范围。"""
        if not times:
            return "无数据"
        return f"{min(times).strftime('%Y-%m-%d %H:%M:%S')} 至 {max(times).strftime('%Y-%m-%d %H:%M:%S')}"

    return {
        "inbound": format_range(inbound_times),
        "outbound": format_range(outbound_times),
        "total": format_range(all_times),
    }


def build_complaint_call_summary(
    loss_records: list[dict[str, Any]],
    inbound_records: list[dict[str, Any]],
    outbound_records: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    agent_mapping: dict[str, str],
) -> dict[str, Any]:
    """只统计呼入明细里分配到投诉座席分机的来电，避免把普通呼入误算成投诉电话。"""
    complaint_config = load_complaint_config()
    complaint_receiver_phones = complaint_config.get("receiverPhones") or [complaint_config["receiverPhone"]]
    complaint_receiver_phone_set = set(complaint_receiver_phones)
    complaint_inbound_records = [
        record for record in inbound_records if normalize_agent_extension(record.get("agent_extension")) in complaint_receiver_phone_set
    ]
    complaint_phone_set = sorted({record["phone"] for record in complaint_inbound_records})
    candidate_by_phone = {str(candidate.get("phone") or ""): candidate for candidate in candidates}
    loss_by_phone: dict[str, list[dict[str, Any]]] = defaultdict(list)
    inbound_by_phone: dict[str, list[dict[str, Any]]] = defaultdict(list)
    outbound_by_phone: dict[str, list[dict[str, Any]]] = defaultdict(list)
    inbound_by_receiver_phone: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for record in loss_records:
        if record["phone"] in complaint_phone_set:
            loss_by_phone[record["phone"]].append(record)
    for record in complaint_inbound_records:
        inbound_by_phone[record["phone"]].append(record)
        inbound_by_receiver_phone[normalize_agent_extension(record.get("agent_extension"))].append(record)
    for record in outbound_records:
        if record["phone"] in complaint_phone_set:
            outbound_by_phone[record["phone"]].append(record)
    for records in loss_by_phone.values():
        records.sort(key=lambda item: item["loss_time"])
    for records in inbound_by_phone.values():
        records.sort(key=lambda item: item["inbound_time"])
    for records in outbound_by_phone.values():
        records.sort(key=lambda item: item["outbound_time"])

    complaint_phones = []
    primary_city_counter: Counter[str] = Counter()
    primary_stage_counter: Counter[str] = Counter()
    latest_complaint_time: datetime | None = None

    def mapped_agent(record: dict[str, Any]) -> tuple[str, str]:
        """同一套坐席映射贯穿投诉页和座席页，避免同一个人显示成两个名字。"""
        extension = normalize_agent_extension(record.get("agent_extension"))
        return map_agent_name(extension, record.get("agent"), agent_mapping), extension

    for phone in complaint_phone_set:
        candidate = candidate_by_phone.get(phone, {})
        phone_loss_records = list(loss_by_phone.get(phone, []))
        phone_inbound_records = list(inbound_by_phone.get(phone, []))
        phone_outbound_records = list(outbound_by_phone.get(phone, []))
        successful_inbound_records = [record for record in phone_inbound_records if record["talk_seconds"] > 0]
        successful_outbound_records = [record for record in phone_outbound_records if record["talk_seconds"] > 0]
        latest_inbound_record = successful_inbound_records[-1] if successful_inbound_records else (phone_inbound_records[-1] if phone_inbound_records else None)
        latest_outbound_record = successful_outbound_records[-1] if successful_outbound_records else (phone_outbound_records[-1] if phone_outbound_records else None)
        latest_inbound_agent_name, latest_inbound_agent_extension = mapped_agent(latest_inbound_record or {}) if latest_inbound_record else ("", "")
        latest_outbound_agent_name, latest_outbound_agent_extension = mapped_agent(latest_outbound_record or {}) if latest_outbound_record else ("", "")

        events = []
        for record in phone_loss_records:
            events.append(
                {
                    "type": "呼损",
                    "time": record["loss_time"],
                    "timeText": record["loss_time_text"],
                    "detail": record["lost_stage"],
                    "city": record["city"],
                    "waitText": format_seconds(record["wait_seconds"]),
                    "talkText": "",
                    "agentName": "",
                    "agentExtension": "",
                    "did": record.get("called_number_text") or record.get("did", ""),
                    "queue": record.get("queue", ""),
                }
            )
        for record in phone_inbound_records:
            agent_name, agent_extension = mapped_agent(record)
            events.append(
                {
                    "type": "呼入",
                    "time": record["inbound_time"],
                    "timeText": record["inbound_time_text"],
                    "detail": "已接通" if record["talk_seconds"] > 0 else "未接通",
                    "city": record["city"],
                    "waitText": format_seconds(record.get("wait_seconds", 0)),
                    "talkText": format_seconds(record["talk_seconds"]),
                    "agentName": agent_name,
                    "agentExtension": agent_extension,
                    "did": record.get("called_number_text", ""),
                    "queue": "",
                }
            )
        for record in phone_outbound_records:
            agent_name, agent_extension = mapped_agent(record)
            events.append(
                {
                    "type": "呼出",
                    "time": record["outbound_time"],
                    "timeText": record["outbound_time_text"],
                    "detail": "已接通" if record["talk_seconds"] > 0 else "未接通",
                    "city": record["city"],
                    "waitText": "",
                    "talkText": format_seconds(record["talk_seconds"]),
                    "agentName": agent_name,
                    "agentExtension": agent_extension,
                    "did": "",
                    "queue": "",
                }
            )
        events.sort(key=lambda item: item["time"], reverse=True)
        complaint_events = [event for event in events if event["type"] == "呼入"]
        complaint_events.sort(key=lambda item: item["time"], reverse=True)
        if complaint_events:
            latest_complaint_time = max(latest_complaint_time or complaint_events[0]["time"], complaint_events[0]["time"])
        recent_events = [{key: value for key, value in event.items() if key != "time"} for event in events[:8]]
        first_call_time = min((event["time"] for event in complaint_events), default=None)
        latest_loss_time = phone_loss_records[-1]["loss_time"] if phone_loss_records else None
        latest_successful_inbound_time = latest_inbound_record["inbound_time"] if latest_inbound_record and latest_inbound_record["talk_seconds"] > 0 else None
        has_success_after_latest_loss = bool(
            latest_successful_inbound_time and (latest_loss_time is None or latest_successful_inbound_time > latest_loss_time)
        )

        did_numbers = sorted(
            {
                str(record.get("called_number_text") or record.get("did") or "").strip()
                for record in [*phone_loss_records, *phone_inbound_records]
                if str(record.get("called_number_text") or record.get("did") or "").strip()
            }
        )
        receiver_extensions = sorted(
            {
                normalize_agent_extension(record.get("agent_extension"))
                for record in phone_inbound_records
                if normalize_agent_extension(record.get("agent_extension"))
            }
        )
        queue_numbers = sorted({str(record.get("queue") or "").strip() for record in phone_loss_records if str(record.get("queue") or "").strip()})
        cities = sorted(
            {
                str(record.get("city") or "").strip()
                for record in [*phone_loss_records, *phone_inbound_records, *phone_outbound_records]
                if str(record.get("city") or "").strip()
            }
        )
        primary_city = str(candidate.get("city") or (cities[0] if cities else "未知"))
        primary_stage = Counter(record["lost_stage"] for record in phone_loss_records).most_common(1)[0][0] if phone_loss_records else "投诉座席"
        primary_city_counter[primary_city] += 1
        primary_stage_counter[primary_stage] += 1

        complaint_call_count = len(phone_inbound_records)
        total_wait_seconds = sum(record.get("wait_seconds", 0) for record in [*phone_loss_records, *phone_inbound_records])
        max_wait_seconds = max((record.get("wait_seconds", 0) for record in [*phone_loss_records, *phone_inbound_records]), default=0)
        score = int(candidate.get("score") or 0)
        priority = str(candidate.get("priority") or ("高" if phone_loss_records and not has_success_after_latest_loss else "低"))
        complaint_phones.append(
            {
                "phone": phone,
                "personName": "未标注",
                "contactName": "",
                "phoneNoteText": "",
                "noteText": "",
                "followupStatus": "pending",
                "priority": priority,
                "score": score,
                "city": primary_city,
                "cities": cities or [primary_city],
                "mainStage": primary_stage,
                "complaintCallCount": complaint_call_count,
                "totalRelatedCallCount": complaint_call_count + len(phone_loss_records) + len(phone_outbound_records),
                "lossCount": len(phone_loss_records),
                "inboundCount": len(phone_inbound_records),
                "successfulInboundCount": len(successful_inbound_records),
                "outboundCount": len(phone_outbound_records),
                "successfulOutboundCount": len(successful_outbound_records),
                "queueLossCount": sum(1 for record in phone_loss_records if "排队" in record.get("lost_stage", "")),
                "totalWaitSeconds": total_wait_seconds,
                "totalWaitText": format_seconds(total_wait_seconds),
                "maxWaitText": format_seconds(max_wait_seconds),
                "latestCallTime": complaint_events[0]["timeText"] if complaint_events else "无",
                "latestRelatedEventTime": events[0]["timeText"] if events else "无",
                "firstCallTime": first_call_time.strftime("%Y-%m-%d %H:%M:%S") if first_call_time else "无",
                "latestLossTime": phone_loss_records[-1]["loss_time_text"] if phone_loss_records else "无",
                "latestSuccessfulInboundTime": latest_inbound_record["inbound_time_text"] if latest_inbound_record and latest_inbound_record["talk_seconds"] > 0 else "无",
                "hasSuccessfulInbound": bool(successful_inbound_records),
                "hasSuccessAfterLatestLoss": has_success_after_latest_loss,
                "latestInboundAgentName": latest_inbound_agent_name or "未填写",
                "latestInboundAgentExtension": latest_inbound_agent_extension,
                "receiverExtensions": receiver_extensions,
                "latestOutboundTime": latest_outbound_record["outbound_time_text"] if latest_outbound_record else "无",
                "latestOutboundAgentName": latest_outbound_agent_name or "未填写",
                "latestOutboundAgentExtension": latest_outbound_agent_extension,
                "didNumbers": did_numbers,
                "queueNumbers": queue_numbers,
                "recentEvents": recent_events,
            }
        )

    complaint_phones.sort(
        key=lambda item: (
            item["priority"] == "高",
            not item["hasSuccessAfterLatestLoss"],
            item["score"],
            item["complaintCallCount"],
            item["latestCallTime"],
        ),
        reverse=True,
    )
    receiver_summary = []
    for receiver_phone in complaint_receiver_phones:
        receiver_records = inbound_by_receiver_phone.get(receiver_phone, [])
        receiver_summary.append(
            {
                "receiverPhone": receiver_phone,
                "complaintPhoneCount": len({record["phone"] for record in receiver_records}),
                "complaintCallCount": len(receiver_records),
                "successfulInboundCount": sum(1 for record in receiver_records if record["talk_seconds"] > 0),
            }
        )
    return {
        "receiverPhones": complaint_receiver_phones,
        "receiverExtensions": complaint_receiver_phones,
        "receiverPhone": complaint_receiver_phones[0],
        "receiverExtension": complaint_receiver_phones[0],
        "ruleText": f"呼入明细里的座席分机属于 {', '.join(complaint_receiver_phones)} 才算投诉电话",
        "summary": {
            "complaintPhoneCount": len(complaint_phones),
            "complaintCallCount": sum(item["complaintCallCount"] for item in complaint_phones),
            "complaintLossCount": sum(item["lossCount"] for item in complaint_phones),
            "complaintInboundCount": sum(item["inboundCount"] for item in complaint_phones),
            "complaintOutboundCount": sum(item["outboundCount"] for item in complaint_phones),
            "repeatComplaintPhoneCount": sum(1 for item in complaint_phones if item["complaintCallCount"] >= 2),
            "unconnectedAfterLossCount": sum(1 for item in complaint_phones if item["lossCount"] > 0 and not item["hasSuccessAfterLatestLoss"]),
            "knownPersonCount": 0,
            "latestComplaintTime": latest_complaint_time.strftime("%Y-%m-%d %H:%M:%S") if latest_complaint_time else "无",
        },
        "phones": complaint_phones,
        "receiverSummary": receiver_summary,
        "citySummary": [{"name": name, "value": count} for name, count in primary_city_counter.most_common(10)],
        "stageSummary": [{"name": name, "value": count} for name, count in primary_stage_counter.most_common(8)],
    }


def analyze_records(
    loss_records: list[dict[str, Any]],
    inbound_records: list[dict[str, Any]],
    outbound_records: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """按号码聚合所有呼损客户，成功呼入只作为风险标识，不再作为排除条件。"""
    outbound_records = outbound_records or []
    agent_mapping = load_agent_mapping()
    inbound_by_phone: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for inbound_record in inbound_records:
        if inbound_record["talk_seconds"] > 0:
            inbound_by_phone[inbound_record["phone"]].append(inbound_record)
    for phone_records in inbound_by_phone.values():
        phone_records.sort(key=lambda item: item["inbound_time"])

    loss_by_phone: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for loss_record in loss_records:
        loss_by_phone[loss_record["phone"]].append(loss_record)
    for phone_records in loss_by_phone.values():
        phone_records.sort(key=lambda item: item["loss_time"])

    candidates = []
    successful_inbound_included_count = 0
    single_loss_included_count = 0

    for phone, phone_loss_records in loss_by_phone.items():
        successful_inbounds = inbound_by_phone.get(phone, [])
        latest_successful_inbound = successful_inbounds[-1] if successful_inbounds else None
        latest_success_time = latest_successful_inbound["inbound_time"] if latest_successful_inbound else None
        latest_loss_time = phone_loss_records[-1]["loss_time"]
        has_success_after_latest_loss = bool(latest_success_time and latest_success_time > latest_loss_time)

        if len(phone_loss_records) == 1:
            single_loss_included_count += 1
        if successful_inbounds:
            successful_inbound_included_count += 1

        total_wait_seconds = sum(record["wait_seconds"] for record in phone_loss_records)
        max_wait_seconds = max(record["wait_seconds"] for record in phone_loss_records)
        queue_loss_count = sum(1 for record in phone_loss_records if "排队" in record["lost_stage"])
        stage_counter = Counter(record["lost_stage"] for record in phone_loss_records)
        city_counter = Counter(record["city"] for record in phone_loss_records)
        score, priority = calculate_priority(
            len(phone_loss_records), total_wait_seconds, queue_loss_count, phone_loss_records[-1]["loss_time"]
        )
        candidates.append(
            {
                "phone": phone,
                "priority": priority,
                "score": score,
                "lossCount": len(phone_loss_records),
                "totalWaitSeconds": total_wait_seconds,
                "totalWaitText": format_seconds(total_wait_seconds),
                "maxWaitText": format_seconds(max_wait_seconds),
                "queueLossCount": queue_loss_count,
                "latestLossTime": phone_loss_records[-1]["loss_time_text"],
                "firstLossTime": phone_loss_records[0]["loss_time_text"],
                "hasSuccessfulInbound": bool(successful_inbounds),
                "successfulInboundCount": len(successful_inbounds),
                "latestSuccessfulInboundTime": latest_successful_inbound["inbound_time_text"] if latest_successful_inbound else "无",
                "hasSuccessAfterLatestLoss": has_success_after_latest_loss,
                "lastSuccessBeforeLoss": latest_success_time.strftime("%Y-%m-%d %H:%M:%S") if latest_success_time else "无",
                "mainStage": stage_counter.most_common(1)[0][0],
                "city": city_counter.most_common(1)[0][0],
                "losses": [
                    {
                        "lossTime": record["loss_time_text"],
                        "stage": record["lost_stage"],
                        "waitText": format_seconds(record["wait_seconds"]),
                        "ivrText": format_seconds(record["ivr_seconds"]),
                        "queueText": format_seconds(record["queue_seconds"]),
                        "city": record["city"],
                    }
                    for record in phone_loss_records
                ],
            }
        )

    candidates.sort(key=lambda item: (item["priority"] == "高", item["score"], item["lossCount"]), reverse=True)

    stage_summary = Counter(record["lost_stage"] for record in loss_records)
    city_summary = Counter(record["city"] for record in loss_records)
    daily_summary = Counter(record["loss_time"].strftime("%Y-%m-%d") for record in loss_records)
    trend_summary = build_daily_trends(loss_records, inbound_records, outbound_records)
    agent_summary = build_agent_summary(inbound_records, outbound_records, agent_mapping)
    agent_time_range = build_agent_time_range(inbound_records, outbound_records)
    complaint_summary = build_complaint_call_summary(loss_records, inbound_records, outbound_records, candidates, agent_mapping)

    return {
        "summary": {
            "lossRows": len(loss_records),
            "inboundRows": len(inbound_records),
            "outboundRows": len(outbound_records),
            "candidateCount": len(candidates),
            "highPriorityCount": sum(1 for item in candidates if item["priority"] == "高"),
            "skippedAfterSuccess": 0,
            "successfulInboundIncludedCount": successful_inbound_included_count,
            "singleLossIncludedCount": single_loss_included_count,
            "singleLossAfterSuccess": 0,
            "uniqueLossPhones": len(loss_by_phone),
        },
        "candidates": candidates,
        "complaints": complaint_summary,
        "charts": {
            "stageSummary": [{"name": name, "value": count} for name, count in stage_summary.most_common(8)],
            "citySummary": [{"name": name, "value": count} for name, count in city_summary.most_common(10)],
            "dailySummary": [{"name": name, "value": daily_summary[name]} for name in sorted(daily_summary)],
            "trendSummary": trend_summary,
            "agentSummary": agent_summary,
            "agentTimeRange": agent_time_range,
            "agentMapping": agent_mapping,
        },
    }


def analyze_raw_tables(raw_tables: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """从三张原始表生成分析结果，供下载与缓存升级共用同一业务入口。"""
    return analyze_records(
        build_loss_records(raw_tables["loss"]),
        build_inbound_records(raw_tables["inbound"]),
        build_outbound_records(raw_tables["outbound"]),
    )
