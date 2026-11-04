export class OrderNumberService {
  create() {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `ORD-${stamp}-${random}`;
  }
}
