export const MAX_NOTIFICATION_ATTEMPTS = 8;
export const MAX_NOTIFICATION_RETRY_DELAY_SECONDS = 300;

export function notificationRetryDelaySeconds(attempts: number) {
  return Math.min(MAX_NOTIFICATION_RETRY_DELAY_SECONDS, 2 ** Math.min(Math.max(attempts, 0), 8));
}
