import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { AppError } from "../../common/errors/app-error";
import {
  escapeHtml,
  renderLuxuryButton,
  renderLuxuryEmailWrapper,
} from "../../common/mail/luxury-email-template";

export interface AuthMailService {
  sendEmailVerification(email: string, rawToken: string): Promise<void>;
  sendPasswordReset(email: string, rawToken: string): Promise<void>;
}

function durationLabel(value: string) {
  const amount = value.slice(0, -1);
  const unit = value.at(-1);
  if (unit === "m") return `${amount} minute${amount === "1" ? "" : "s"}`;
  if (unit === "h") return `${amount} hour${amount === "1" ? "" : "s"}`;
  return value;
}

export function passwordResetEmail(email: string, rawToken: string) {
  const url = new URL("/reset-password", env.FRONTEND_URL);
  url.searchParams.set("token", rawToken);
  const resetUrl = url.toString();
  const expiry = durationLabel(env.AUTH_RESET_TOKEN_EXPIRES_IN);

  const text = [
    "Shoezy password reset",
    "We received a request to reset your Shoezy password.",
    `Reset your password: ${resetUrl}`,
    `This link expires in ${expiry} and can only be used once.`,
    "If you did not request this, you can safely ignore this email.",
  ].join("\n\n");

  const contentHtml = `
    <div style="text-align:center;padding:8px 0 16px 0;">
      <div style="font-size:22px;font-weight:800;color:#111111;margin-bottom:8px;line-height:1.2;">
        Reset Your Password
      </div>
      <div style="font-size:14px;color:#52525B;line-height:1.6;max-width:440px;margin:0 auto;">
        We received a request to reset the password for your SHOEZY account. Click the button below to choose a new password.
      </div>

      <div style="margin:28px 0;">
        ${renderLuxuryButton("Reset Password →", resetUrl)}
      </div>

      <div style="background-color:#F9F9FB;border:1px solid #E4E4E7;border-radius:8px;padding:14px 16px;max-width:440px;margin:0 auto;text-align:left;">
        <div style="font-size:12px;color:#52525B;line-height:1.5;">
          &bull; This link expires in <strong>${escapeHtml(expiry)}</strong> and can only be used once.
        </div>
        <div style="font-size:12px;color:#71717A;line-height:1.5;margin-top:6px;">
          &bull; If you did not request this, you can safely ignore this email. Your password will remain unchanged.
        </div>
      </div>
    </div>
  `;

  const html = renderLuxuryEmailWrapper({
    previewText: "Reset your Shoezy account password",
    headerBadge: "SECURITY",
    title: "Reset your Shoezy password",
    contentHtml,
    footerNote: "For security, never share this link with anyone. Shoezy support will never ask for your password.",
  });

  return {
    to: email,
    subject: "Reset your Shoezy password",
    text,
    html,
  };
}

export function emailVerificationTemplate(email: string, rawToken: string) {
  const url = new URL("/verify-email", env.FRONTEND_URL);
  url.searchParams.set("token", rawToken);
  const verifyUrl = url.toString();

  const text = `Verify your email using this link: ${verifyUrl}`;

  const contentHtml = `
    <div style="text-align:center;padding:8px 0 16px 0;">
      <div style="font-size:22px;font-weight:800;color:#111111;margin-bottom:8px;line-height:1.2;">
        Verify Your Email Address
      </div>
      <div style="font-size:14px;color:#52525B;line-height:1.6;max-width:440px;margin:0 auto;">
        Welcome to SHOEZY. Please verify your email address to confirm your account and access exclusive features.
      </div>

      <div style="margin:28px 0;">
        ${renderLuxuryButton("Verify Email Address →", verifyUrl)}
      </div>

      <div style="font-size:12px;color:#71717A;line-height:1.5;max-width:440px;margin:0 auto;">
        If you didn't create an account with SHOEZY, you can safely ignore this email.
      </div>
    </div>
  `;

  const html = renderLuxuryEmailWrapper({
    previewText: "Verify your email address for SHOEZY",
    headerBadge: "VERIFICATION",
    title: "Verify your email",
    contentHtml,
  });

  return {
    to: email,
    subject: "Verify your email",
    text,
    html,
  };
}

export class SmtpAuthMailService implements AuthMailService {
  private requireConfiguration() {
    if (!env.SMTP_HOST || !env.MAIL_FROM) {
      throw new AppError(503, "Email delivery is not configured", "AUTH_EMAIL_DELIVERY_FAILED");
    }
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && env.SMTP_PASSWORD
          ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
          : undefined,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 30_000,
    });
  }

  async sendEmailVerification(email: string, rawToken: string): Promise<void> {
    const transport = this.requireConfiguration();
    const message = emailVerificationTemplate(email, rawToken);
    await transport.sendMail({
      from: { name: env.MAIL_FROM_NAME ?? "Shoezy", address: env.MAIL_FROM! },
      ...message,
    });
  }

  async sendPasswordReset(email: string, rawToken: string): Promise<void> {
    const transport = this.requireConfiguration();
    await transport.sendMail({
      from: { name: env.MAIL_FROM_NAME ?? "Shoezy", address: env.MAIL_FROM! },
      ...passwordResetEmail(email, rawToken),
    });
  }
}
