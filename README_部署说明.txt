PaperBook Cloud Web V1
======================

本包已绑定你的 Supabase 前端配置：
Project URL: https://ylxgsvoenrtoxehuzzgr.supabase.co
Publishable key: 已写入 app.js（该密钥是网页客户端公开密钥）

上线前必须执行：
1. 进入 Supabase 左侧 SQL Editor。
2. 新建查询。
3. 粘贴 supabase_schema.sql 全部内容。
4. 点击 Run。
5. 在 Authentication → URL Configuration 配置网站 URL。
6. 上传本目录到 GitHub Pages、Cloudflare Pages 或其他静态托管。

本地测试：
直接双击 index.html 可能受浏览器模块安全限制。
推荐在本目录运行：
python -m http.server 8080
然后访问：
http://localhost:8080

功能：
- 邮箱注册、登录、退出和找回密码
- 每个用户自动创建私人工作区
- 多笔记本
- 多页面和页码翻页
- 富文本编辑
- 700ms 自动云保存
- revision 并发冲突检测
- 当前笔记本搜索
- JSON 导入和导出
- 深色模式
- 手机适配
- PWA 基础缓存

安全：
- 不含数据库密码、Secret key 或 service_role key。
- Publishable key 可用于前端。
- 用户数据安全依赖 Supabase Auth + RLS。
- 上线前必须用两个测试账号验证数据隔离。
