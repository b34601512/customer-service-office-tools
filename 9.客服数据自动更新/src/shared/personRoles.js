function normalizePersonRole(value) {
  // 这个函数只保留系统认可的客服岗位。
  const personRole = String(value || "").trim();
  return ["售前", "售后"].includes(personRole) ? personRole : "";
}

function createPersonRoleMap(personMappings) {
  // 这个函数只把后台客服设置转换成姓名对应的岗位表。
  return new Map(
    (Array.isArray(personMappings) ? personMappings : [])
      .map((mapping) => [String(mapping?.summaryName || "").trim(), normalizePersonRole(mapping?.role)])
      .filter(([personName, personRole]) => personName && personRole)
  );
}

function createPersonRoleRecord(personMappings) {
  // 这个函数只把岗位表转换成写入明细时可传递的普通对象。
  return Object.fromEntries(createPersonRoleMap(personMappings));
}

module.exports = {
  normalizePersonRole,
  createPersonRoleMap,
  createPersonRoleRecord
};
