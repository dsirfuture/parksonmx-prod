export enum UserRole {
  ADMIN = "ADMIN",
  WORKER = "WORKER",
  CUSTOMER = "CUSTOMER",
}

export enum ItemStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
}

export interface Item {
  id: string;
  receiptId: string;
  sku: string;
  nameEn: string;
  nameZh: string;
  barcode: string;
  expectedQty: number;
  goodQty: number;
  damagedQty: number;
  status: ItemStatus;
  evidenceCount: number;
  locked: boolean;
  version: number;
  category: string;
}

export interface AuthContextType {
  role: UserRole;
  tenantId: string;
  companyId: string;
  userId?: string;
  shareToken?: string;
  isReadOnly: boolean;
  setAuth: (data: Partial<AuthContextType>) => void;
}