// 探针：验证 Vercel 是否构建本项目的 Serverless Functions
export default function handler(req, res) {
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.send('hello from babel api');
}
