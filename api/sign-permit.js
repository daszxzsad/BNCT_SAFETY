const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const BASE_URL = process.env.BASE_URL || 'https://bnct-safety.vercel.app';
// 환경변수 설정 필요:
// APPROVER_NAME  = 최종 승인자 이름 (예: 이병문)
// APPROVER_EMAIL = 최종 승인자 이메일 (예: bm.lee@bnctkorea.com)
// CC_EMAIL       = 참조 이메일 (예: hj.park@bnctkorea.com - 박형진)
// SYSTEM_NAME    = 시스템 이름 (예: BNCT 전자결재)

function makeTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

function emailLayout(title, body, btnLabel, btnUrl, info) {
  const sysName = process.env.SYSTEM_NAME || '안전서류 전자결재 시스템';
  const infoRows = Object.entries(info).map(([k,v], i) => `
    <tr style="background:${i%2===0?'#f5f7fa':'white'}">
      <td style="padding:10px 16px;font-weight:700;color:#555;width:110px;border:1px solid #e0e0e0;">${k}</td>
      <td style="padding:10px 16px;border:1px solid #e0e0e0;">${v}</td>
    </tr>`).join('');

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#003087,#1565c0);padding:24px 32px;border-radius:8px 8px 0 0;">
      <div style="color:white;font-size:22px;font-weight:900;letter-spacing:3px;">${sysName}</div>
    </div>
    <div style="background:white;padding:32px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
      <p style="font-size:15px;color:#333;margin-bottom:20px;">${title}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">${infoRows}</table>
      ${body}
      ${btnUrl ? `
      <div style="margin:20px 0;padding:16px;border:1px solid #ccc;border-radius:6px;background:#f9f9f9;">
        <div style="font-size:14px;font-weight:700;color:#000;margin-bottom:8px;">✏️ ${btnLabel}</div>
        <a href="${btnUrl}" style="font-size:13px;color:#003087;word-break:break-all;">${btnUrl}</a>
        <div style="margin-top:6px;font-size:11px;color:#666;">링크 유효기간: 7일</div>
      </div>` : ''}
      <p style="font-size:11px;color:#aaa;margin-top:20px;text-align:center;">본 메일은 ${sysName}에서 자동 발송되었습니다.</p>
    </div>
  </div>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { token, step, data } = req.body;

    if (!token || !step) return res.status(400).json({ error: '필수값 누락' });

    const { data: permit, error: fetchErr } = await supabase
      .from('permits').select('*').eq('token', token).single();
    if (fetchErr || !permit) return res.status(404).json({ error: '서류를 찾을 수 없습니다.' });

    const managers = JSON.parse(permit.managers || '[]');
    const mgr = managers[0] || {};
    const proj = permit.project_name || '';
    const comp = permit.company_name || '';
    const info = { '공사명': proj, '업체명': comp, '작업인원': (permit.worker_count||'-')+'명', '제출일시': permit.submit_date||'' };

    const approverName  = process.env.APPROVER_NAME  || '승인 담당자';
    const approverEmail = process.env.APPROVER_EMAIL || '';
    const ccEmail       = process.env.CC_EMAIL       || ''; // 박형진

    if (step === 's3') {
      await supabase.from('permits').update({
        s3_name: data.name, s3_sig: data.sig,
        s3_date: data.date, s3_time: data.time,
        s3_checks: JSON.stringify(data.checks || []),
        s3_signed_at: new Date().toISOString(),
        status: 'pending_s4'
      }).eq('token', token);

      // 승인자(이병문)에게 S4 서명 요청 이메일 + 박형진 CC
      if (approverEmail) {
        const url = `${BASE_URL}/sign?token=${token}&role=s4`;
        const mailOpts = {
          from: `"${process.env.SYSTEM_NAME||'전자결재 시스템'}" <${process.env.GMAIL_USER}>`,
          to: `"${approverName}" <${approverEmail}>`,
          subject: `[전자결재] ${proj} - ${comp} Section 4 서명 요청`,
          html: emailLayout(
            `안녕하세요, <strong>${approverName}</strong>님.<br>Section 3 서명이 완료되었습니다. Section 4 서명을 요청드립니다.`,
            `<div style="background:#e8f0fe;border-left:4px solid #1565c0;padding:12px 16px;border-radius:4px;font-size:13px;margin-bottom:16px;">담당자 Section 3 서명 완료 — 최종 승인이 필요합니다.</div>`,
            'Section 4 서명하러 가기', url, info
          )
        };
        if (ccEmail) mailOpts.cc = ccEmail;
        await makeTransporter().sendMail(mailOpts);
      }
      return res.status(200).json({ success: true, status: 'pending_s4' });

    } else if (step === 's4') {
      await supabase.from('permits').update({
        s4_name: data.name, s4_sig: data.sig,
        s4_date: data.date, s4_time: data.time,
        s4_checks: JSON.stringify(data.checks || []),
        s4_limit_date: data.limitDate || '', s4_limit_time: data.limitTime || '',
        s4_signed_at: new Date().toISOString(),
        status: 'active'
      }).eq('token', token);

      // 담당자 + 승인자 둘 다에게 완료 이메일 + 박형진 CC
      const activeUrl = `${BASE_URL}/sign?token=${token}&role=active`;
      const transporter = makeTransporter();
      const subject = `[전자결재] ${proj} - ${comp} 승인 완료`;
      const body = `<div style="background:#d4edda;border-left:4px solid #28a745;padding:12px 16px;border-radius:4px;font-size:13px;margin-bottom:16px;">✅ Section 3, 4 서명 완료 — Section 5~10은 아래 링크에서 작성 가능합니다.</div>`;

      if (mgr.email) {
        const mailOpts = {
          from: `"${process.env.SYSTEM_NAME||'전자결재 시스템'}" <${process.env.GMAIL_USER}>`,
          to: `"${mgr.name}" <${mgr.email}>`,
          subject,
          html: emailLayout(`안녕하세요, <strong>${mgr.name}</strong>님.<br>작업허가서 승인이 완료되었습니다.`, body, 'Section 5~10 작성하러 가기', activeUrl, info)
        };
        if (ccEmail) mailOpts.cc = ccEmail;
        await transporter.sendMail(mailOpts);
      }
      if (approverEmail) {
        const mailOpts = {
          from: `"${process.env.SYSTEM_NAME||'전자결재 시스템'}" <${process.env.GMAIL_USER}>`,
          to: `"${approverName}" <${approverEmail}>`,
          subject,
          html: emailLayout(`안녕하세요, <strong>${approverName}</strong>님.<br>귀하의 서명이 저장되었습니다.`, body, 'Section 5~10 작성하러 가기', activeUrl, info)
        };
        if (ccEmail) mailOpts.cc = ccEmail;
        await transporter.sendMail(mailOpts);
      }
      return res.status(200).json({ success: true, status: 'active' });

    } else if (step === 's5to10') {
      await supabase.from('permits').update({
        s5_to_s10: JSON.stringify(data),
        status: data.completed ? 'completed' : 'active'
      }).eq('token', token);
      return res.status(200).json({ success: true });

    } else {
      return res.status(400).json({ error: '알 수 없는 step' });
    }

  } catch (err) {
    console.error('sign-permit 오류:', err);
    return res.status(500).json({ error: err.message });
  }
};
