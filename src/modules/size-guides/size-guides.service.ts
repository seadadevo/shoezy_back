import { AppError } from "../../common/errors/app-error";
import { toSizeGuideDetailDto, toSizeGuideDto, toSizeGuideEntryDto } from "./size-guides.dto";
import { SizeGuidesRepository } from "./size-guides.repository";
import type { CreateSizeGuideEntryInput, CreateSizeGuideInput, ListSizeGuidesQuery, UpdateSizeGuideEntryInput, UpdateSizeGuideInput } from "./size-guides.validation";
export interface SizeGuidesStore {
  list: SizeGuidesRepository["list"]; findBrand: SizeGuidesRepository["findBrand"]; findById: SizeGuidesRepository["findById"];
  findDetail: SizeGuidesRepository["findDetail"]; create: SizeGuidesRepository["create"]; update: SizeGuidesRepository["update"];
  updateAggregate?: SizeGuidesRepository["updateAggregate"];
  findEntry: SizeGuidesRepository["findEntry"]; createEntry: SizeGuidesRepository["createEntry"]; updateEntry: SizeGuidesRepository["updateEntry"];
  deleteEntry: SizeGuidesRepository["deleteEntry"]; deleteIfUnused: SizeGuidesRepository["deleteIfUnused"];
}
export class SizeGuidesService {
  constructor(private readonly repository: SizeGuidesStore = new SizeGuidesRepository()) {}
  private async validateBrand(brandId: string | null | undefined) { if (brandId && !await this.repository.findBrand(brandId)) throw new AppError(404, "Brand not found", "BRAND_NOT_FOUND"); }
  async list(query: ListSizeGuidesQuery) { const result = await this.repository.list(query); return { items: result.items.map(toSizeGuideDto), pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } }; }
  async get(id: string) { const guide = await this.repository.findDetail(id); if (!guide) throw new AppError(404, "Size guide not found", "SIZE_GUIDE_NOT_FOUND"); return toSizeGuideDetailDto(guide); }
  async create(input: CreateSizeGuideInput, actorId?: string) { await this.validateBrand(input.brandId); const guide = await this.repository.create(input, actorId); return input.entries === undefined ? toSizeGuideDto(guide) : this.get(guide.id); }
  async update(id: string, input: UpdateSizeGuideInput, actorId?: string) { await this.validateBrand(input.brandId); const guide = input.entries === undefined ? await this.repository.update(id, input) : await (this.repository.updateAggregate?.(id, input, actorId) ?? new SizeGuidesRepository().updateAggregate(id, input, actorId)); if (!guide) throw new AppError(404, "Size guide not found", "SIZE_GUIDE_NOT_FOUND"); return input.entries === undefined ? toSizeGuideDto(guide) : this.get(id); }
  async createEntry(id: string, input: CreateSizeGuideEntryInput) { if (!await this.repository.findById(id)) throw new AppError(404, "Size guide not found", "SIZE_GUIDE_NOT_FOUND"); return toSizeGuideEntryDto(await this.repository.createEntry(id, input)); }
  async updateEntry(id: string, entryId: string, input: UpdateSizeGuideEntryInput) {
    const current = await this.repository.findEntry(id, entryId);
    if (!current) throw new AppError(404, "Size guide entry not found", "SIZE_GUIDE_ENTRY_NOT_FOUND");
    const merged = { euSize: current.euSize, usSize: current.usSize, ukSize: current.ukSize, footLengthCm: current.footLengthCm?.toString() ?? null, ...input };
    if (!merged.euSize && !merged.usSize && !merged.ukSize && !merged.footLengthCm) throw new AppError(400, "At least one size measurement is required", "SIZE_GUIDE_ENTRY_EMPTY");
    const entry = await this.repository.updateEntry(id, entryId, input);
    if (!entry) throw new AppError(404, "Size guide entry not found", "SIZE_GUIDE_ENTRY_NOT_FOUND");
    return toSizeGuideEntryDto(entry);
  }
  async deleteEntry(id: string, entryId: string): Promise<void> { if (!await this.repository.deleteEntry(id, entryId)) throw new AppError(404, "Size guide entry not found", "SIZE_GUIDE_ENTRY_NOT_FOUND"); }
  async delete(id: string): Promise<void> { const result = await this.repository.deleteIfUnused(id); if (result === "NOT_FOUND") throw new AppError(404, "Size guide not found", "SIZE_GUIDE_NOT_FOUND"); if (result === "IN_USE") throw new AppError(409, "Size guide is in use", "SIZE_GUIDE_IN_USE"); }
}
