export interface ProxyInput {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
}

export interface ActorInput {
    searchQueries?: string[];
    maxResults?: number;
    maxPagesPerQuery?: number;
    proxyConfiguration?: ProxyInput;
}

export interface NormalizedInput {
    searchQueries: string[];
    maxResults: number;
    maxPagesPerQuery: number;
    proxyConfiguration: ProxyInput;
}

export interface ProductRecord {
    source: 'aliexpress';
    searchQuery: string;
    position: number;
    productId: string | null;
    title: string;
    brand: string;
    price: number;
    mrp: number | null;
    discountPercent: number | null;
    currency: string;
    packSize: string;
    category: string;
    rating: number | null;
    ratingCount: number | null;
    soldCount: number | null;
    inStock: boolean | null;
    productUrl: string | null;
    imageUrl: string | null;
    scrapedAt: string;
}

export interface RequestData {
    searchQuery: string;
    pageNumber: number;
}
