const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const BASE_URL = 'YOUR_VERCEL_URL';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = createClient('https://atkqhpsyxcpeamradfql.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0a3FocHN5eGNwZWFtcmFkZnFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODQxMjEsImV4cCI6MjA5MjI2MDEyMX0.cmibdYu2D493a2ufNfmsRbclfQ3cJDXHfHKEitDsyzs');
    const { projectName, companyName, workerCount, submitDate, managers, forms, formData } = req.body;

    const token = Math.random().toString(36).substr(2,12) + Date.now().toString(36);

    const { error } = await supabase.from('permits').insert({
      token,
      project_name: projectName,
      company_name: companyName,
      worker_count: workerCount,
      submit_date: submitDate,
      managers: JSON.stringify(managers || []),
      forms: JSON.stringify(forms || []),
      form_fields: JSON.stringify(formData || {}),
      status: 'pending_s3',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7*24*60*60*1000).toISOString()
    });
    if (error) throw error;

    // 담당자에게 이메일 (Section 3 서명 요청)
    const mgr = (managers || [])[0] || {};
    if (mgr.email) {
      const sigUrl = `${BASE_URL}/sign?token=${token}&role=s3`;
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
      });
      await transporter.sendMail({
        from: `"BNCT 안전서류 시스템" <${process.env.GMAIL_USER}>`,
        to: `"${mgr.name}" <${mgr.email}>`,
        subject: `[BNCT 전자결재] ${projectName} - ${companyName} Section 3 서명 요청`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#003087,#1565c0);padding:24px 32px;border-radius:8px 8px 0 0;">
              <div style="color:white;font-size:26px;font-weight:900;letter-spacing:4px;">BNCT</div>
              <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px;">자산관리팀 안전서류 전자결재 시스템</div>
            </div>
            <div style="background:white;padding:32px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;color:#333;margin-bottom:20px;">
                안녕하세요, <strong>${mgr.name}</strong> 담당자님.<br>
                아래 작업허가서의 Section 3 서명을 요청드립니다.
              </p>
              <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
                <tr style="background:#f5f7fa;"><td style="padding:10px 16px;font-weight:700;color:#555;width:110px;border:1px solid #e0e0e0;">공사명</td><td style="padding:10px 16px;border:1px solid #e0e0e0;">${projectName}</td></tr>
                <tr><td style="padding:10px 16px;font-weight:700;color:#555;border:1px solid #e0e0e0;">업체명</td><td style="padding:10px 16px;border:1px solid #e0e0e0;">${companyName}</td></tr>
                <tr style="background:#f5f7fa;"><td style="padding:10px 16px;font-weight:700;color:#555;border:1px solid #e0e0e0;">작업인원</td><td style="padding:10px 16px;border:1px solid #e0e0e0;">${workerCount}명</td></tr>
                <tr><td style="padding:10px 16px;font-weight:700;color:#555;border:1px solid #e0e0e0;">제출일시</td><td style="padding:10px 16px;border:1px solid #e0e0e0;">${submitDate}</td></tr>
              </table>
              <div style="background:#e8f0fe;border-left:4px solid #1565c0;padding:12px 16px;border-radius:4px;font-size:13px;margin-bottom:20px;">
                외주작업자가 Section 1, 2 작성 및 서명을 완료하였습니다.<br>아래 링크에서 내용 확인 후 Section 3 서명을 진행해 주세요.
              </div>
              <div style="margin:20px 0;padding:16px;border:1px solid #ccc;border-radius:6px;background:#f9f9f9;">
                <div style="font-size:14px;font-weight:700;color:#000;margin-bottom:8px;">✏️ Section 3 서명하러 가기</div>
                <a href="${sigUrl}" style="font-size:13px;color:#003087;word-break:break-all;">${sigUrl}</a>
                <div style="margin-top:6px;font-size:11px;color:#666;">링크 유효기간: 7일</div>
              </div>
              <p style="font-size:11px;color:#aaa;margin-top:20px;text-align:center;">본 메일은 BNCT 자산관리팀 안전서류 시스템에서 자동 발송되었습니다.</p>
            </div>
          </div>`
      });
    }

    return res.status(200).json({ success: true, token });
  } catch (err) {
    console.error('create-permit 오류:', err);
    return res.status(500).json({ error: err.message });
  }
};
