import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { AppError } from "../../common/errors/app-error";

export interface AuthMailService {
  sendEmailVerification(email: string, rawToken: string): Promise<void>;
  sendPasswordReset(email: string, rawToken: string): Promise<void>;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

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
  return {
    to: email,
    subject: "Reset your Shoezy password",
    text: [
      "Shoezy password reset",
      "We received a request to reset your Shoezy password.",
      `Reset your password: ${resetUrl}`,
      `This link expires in ${expiry} and can only be used once.`,
      "If you did not request this, you can safely ignore this email.",
    ].join("\n\n"),
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><h1 style="font-size:28px">Shoezy</h1><p>We received a request to reset your Shoezy password.</p><p style="margin:28px 0"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px">Reset Password</a></p><p>This link expires in ${escapeHtml(expiry)} and can only be used once.</p><p style="color:#666">If you did not request this, you can safely ignore this email.</p></div>`,
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
    const url = new URL("/verify-email", env.FRONTEND_URL);
    url.searchParams.set("token", rawToken);
    await transport.sendMail({
      from: { name: env.MAIL_FROM_NAME ?? "Shoezy", address: env.MAIL_FROM! },
      to: email,
      subject: "Verify your email",
      text: `Verify your email using this link: ${url.toString()}`,
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
