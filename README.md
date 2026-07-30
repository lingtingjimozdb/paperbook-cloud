# PaperBook

PaperBook 是一个以 Supabase 为云端数据层的轻量笔记应用，支持桌面网页、手机 PWA 和 Android 扫描版。

## 当前版本

- Web/PWA：V6 统一界面与语音工作台候选版
- Android：V6 UI + V2 原生扫描/OCR
- 登录：账号名 + 密码（无需填写真实邮箱）

## 语音工作台

- 语音输入并写入当前文档
- 连续会议转录与重点时间标记
- 会议内容智能整理为概览、结论、行动项、重点和风险
- 完整转录或会议纪要写入当前笔记
- 当前文档文字转语音
- 朗读音色、语速、音调、播放、暂停和停止控制

语音识别使用浏览器或设备提供的 Web Speech 能力。首次使用需要授予麦克风权限；开始会议录音前应征得参会者同意。

## 本地预览

```bash
python -m http.server 8080
```

访问 `http://localhost:8080`。ES Module、PWA 和相机能力需要通过 HTTP/HTTPS 打开，不能直接双击 `index.html`。

## 发布

根目录由 GitHub Pages 托管。对 `android-app/**` 或 Android 工作流的修改会触发 APK 构建，产物名为 `PaperBook-Android-V6-Voice-Studio-Beta`。

## 安全说明

- 仓库只允许包含 Supabase publishable key。
- 禁止提交 `service_role` key、数据库密码、GitHub token、用户密码和真实证件图片。
- 扫描原图默认仅保存在本机，不会自动上传。

详见项目交接与维护文档。
