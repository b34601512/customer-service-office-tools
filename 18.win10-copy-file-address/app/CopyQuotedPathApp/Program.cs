using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        // 直接处理右键菜单传入的目标路径，并稳定写入带双引号的完整路径。
        try
        {
            if (args.Length != 1)
            {
                throw new InvalidOperationException(string.Format("参数数量错误，必须传入一个目标路径，实际收到：{0}", args.Length));
            }

            string targetPath = args[0];
            if (!File.Exists(targetPath) && !Directory.Exists(targetPath))
            {
                throw new FileNotFoundException(string.Format("目标路径不存在：{0}", targetPath));
            }

            string quotedPath = string.Format("\"{0}\"", Path.GetFullPath(targetPath));
            DateTime deadline = DateTime.UtcNow.AddMilliseconds(1200);
            int attemptCount = 0;
            while (true)
            {
                attemptCount += 1;
                try
                {
                    Clipboard.SetText(quotedPath);
                    return 0;
                }
                catch (ExternalException)
                {
                    if (DateTime.UtcNow >= deadline)
                    {
                        throw;
                    }

                    Thread.Sleep(60);
                }
                catch (Exception exception)
                {
                    throw new InvalidOperationException(string.Format("第 {0} 次写入剪贴板失败：{1}", attemptCount, exception.Message), exception);
                }
            }
        }
        catch (Exception exception)
        {
            MessageBox.Show(exception.Message, "复制文件地址失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
