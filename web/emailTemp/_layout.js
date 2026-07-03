export function renderEmailLayout({
    heading,
    bodyHtml,
    storeName = "Sonova Team",
    signOff = "Kind regards,",
  }) {
    return `
      <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f8fb; padding:40px 20px;">
        <div style="max-width:600px; margin:auto; background:#ffffff; padding:40px; border-radius:8px;">
          <h2 style="margin-top:0;">${heading}</h2>
          ${bodyHtml}
          <p style="margin-top:30px;">
            ${signOff}<br/>
            <strong>${storeName}</strong>
          </p>
        </div>
      </div>
    `;
  }
  
  export function emailButton({ href, label }) {
    return `
      <a href="${href}" style="display:inline-block; background:#000; color:#fff; padding:12px 24px; text-decoration:none; border-radius:4px; font-weight:bold;">
        ${label}
      </a>
    `;
  }
  