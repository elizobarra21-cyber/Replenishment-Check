// Email provider for the PDF report. The provider is intentionally pluggable and
// disabled unless configured: per the product decision, we ship PDF generation +
// this interface now and turn on sending once a service is chosen.
//
// A Resend path is wired behind RESEND_API_KEY so that choosing Resend later
// needs only env vars (no code change). Other providers (SMTP, etc.) can add a
// branch here.

export function mailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export type ReportEmail = {
  to: string;
  subject: string;
  text: string;
  filename: string;
  pdf: Uint8Array;
};

export async function sendReportEmail(email: ReportEmail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("Email provider not configured");
  }

  const from = process.env.REPORT_FROM || "Store Replenishment <onboarding@resend.dev>";
  const content = Buffer.from(email.pdf).toString("base64");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      attachments: [{ filename: email.filename, content }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Email send failed (${res.status})`);
  }
}
