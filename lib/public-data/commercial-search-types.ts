export type CommercialSearchKind = "areas" | "industries" | "stores";

export interface CommercialSearchProvince {
  code: string;
  name: string;
}

export interface CommercialIndustryOption {
  code: string;
  name: string;
  level: "large";
}

export interface CommercialAreaSearchItem {
  id: string;
  areaCode: string;
  name: string;
  provinceCode: string;
  province: string;
  districtCode: string | null;
  district: string | null;
  areaSquareMeters: number | null;
  center: {
    latitude: number;
    longitude: number;
  } | null;
  referenceDate: string | null;
}

export interface CommercialStoreSearchItem {
  id: string;
  name: string;
  branchName: string | null;
  industry: {
    majorCode: string | null;
    majorName: string | null;
    middleCode: string | null;
    middleName: string | null;
    minorCode: string | null;
    minorName: string | null;
    standardCode: string | null;
    standardName: string | null;
  };
  address: {
    road: string | null;
    lot: string | null;
    postalCode: string | null;
    provinceCode: string | null;
    province: string | null;
    districtCode: string | null;
    district: string | null;
    neighborhood: string | null;
    building: string | null;
  };
  location: {
    latitude: number;
    longitude: number;
    precision: "point";
  } | null;
}

export interface CommercialIndustryCompositionItem {
  code: string | null;
  name: string;
  count: number;
  sharePercent: number;
}

export interface CommercialSearchMeta {
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
  expiresAt: string;
  cached: boolean;
  partial: boolean;
  dataBasis: "official-store-location" | "official-commercial-area" | "official-industry-classification";
}

export interface CommercialAreaSearchResponse {
  kind: "areas";
  items: CommercialAreaSearchItem[];
  page: number;
  pageSize: number;
  total: number;
  providerTotalCount: number;
  hasMore: boolean;
  query: string;
  province: CommercialSearchProvince;
  meta: CommercialSearchMeta;
}

export interface CommercialIndustrySearchResponse {
  kind: "industries";
  items: CommercialIndustryOption[];
  meta: CommercialSearchMeta;
}

export interface CommercialStoreSearchResponse {
  kind: "stores";
  items: CommercialStoreSearchItem[];
  page: number;
  pageSize: number;
  providerTotalCount: number;
  hasMore: boolean;
  scope: {
    type: "province" | "commercial-area";
    code: string;
    label: string;
    industryCode: string | null;
    industryName: string | null;
  };
  composition: {
    basis: "current-provider-page";
    total: number;
    items: CommercialIndustryCompositionItem[];
  };
  meta: CommercialSearchMeta;
}

export type CommercialSearchResponse =
  | CommercialAreaSearchResponse
  | CommercialIndustrySearchResponse
  | CommercialStoreSearchResponse;
