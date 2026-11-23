import { env } from "../../config/env";

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]!)
  );

export function safeSubject(value: string): string {
  return [...value]
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? " "
        : character
    )
    .join("");
}

export function formatHumanDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    }).format(date) + " UTC";
  } catch {
    return date.toUTCString();
  }
}

export function renderStatusBadge(status: string): string {
  const s = status.toUpperCase();
  let bg = "#F3F4F6";
  let color = "#374151";
  let border = "#E5E7EB";

  if (s === "PENDING") {
    bg = "#FEF3C7";
    color = "#92400E";
    border = "#FDE68A";
  } else if (s === "CONFIRMED" || s === "PROCESSING") {
    bg = "#DBEAFE";
    color = "#1E40AF";
    border = "#BFDBFE";
  } else if (s === "SHIPPED") {
    bg = "#EDE9FE";
    color = "#5B21B6";
    border = "#DDD6FE";
  } else if (s === "DELIVERED" || s === "COMPLETED") {
    bg = "#DEF7EC";
    color = "#03543F";
    border = "#BCF0DA";
  } else if (s === "CANCELLED" || s === "REFUNDED") {
    bg = "#FDE8E8";
    color = "#9B1C1C";
    border = "#FBD5D5";
  }

  return `<span style="display:inline-block;background-color:${bg};color:${color};border:1px solid ${border};padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">${escapeHtml(s)}</span>`;
}

export function renderLuxuryButton(label: string, url: string): string {
  return `
    <table border="0" cellpadding="0" cellspacing="0" style="margin: 24px auto;">
      <tr>
        <td align="center" style="background-color: #111111; border-radius: 8px;">
          <a href="${escapeHtml(url)}" style="display: inline-block; padding: 13px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; color: #FFFFFF; text-decoration: none; border-radius: 8px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

export type LuxuryEmailWrapperOptions = {
  previewText?: string;
  headerBadge?: string;
  title?: string;
  contentHtml: string;
  footerNote?: string;
};

export function renderLuxuryEmailWrapper(options: LuxuryEmailWrapperOptions): string {
  const year = new Date().getFullYear();
  const preheaderHtml = options.previewText
    ? `<div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
        ${escapeHtml(options.previewText)}
        &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
      </div>`
    : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title ?? "SHOEZY")}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#18181B;">
  ${preheaderHtml}
  <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#F4F4F5" style="background-color:#F4F4F5;padding:32px 12px;">
    <tr>
      <td align="center" valign="top">
        <!-- Main Card Container (max-width: 600px) -->
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;border:1px solid #E4E4E7;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
          <!-- Brand Header -->
          <tr>
            <td align="center" style="padding:32px 24px 20px 24px;border-bottom:1px solid #F4F4F5;">
              <div style="font-size:26px;font-weight:800;letter-spacing:4px;color:#111111;text-transform:uppercase;line-height:1;">
                SHOEZY
              </div>
              <div style="font-size:9px;font-weight:600;letter-spacing:2.5px;color:#71717A;text-transform:uppercase;margin-top:6px;">
                ${escapeHtml(options.headerBadge ?? "LUXURY FOOTWEAR")}
              </div>
            </td>
          </tr>

          <!-- Email Content Body -->
          <tr>
            <td style="padding:28px 24px 32px 24px;">
              ${options.contentHtml}
            </td>
          </tr>

          <!-- Brand Footer -->
          <tr>
            <td style="background-color:#FAFAFA;border-top:1px solid #F4F4F5;padding:24px;text-align:center;">
              ${
                options.footerNote
                  ? `<div style="font-size:12px;color:#71717A;margin-bottom:12px;line-height:1.5;">${options.footerNote}</div>`
                  : ""
              }
              <div style="font-size:11px;color:#A1A1AA;letter-spacing:0.5px;line-height:1.4;">
                &copy; ${year} SHOEZY. All rights reserved.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
