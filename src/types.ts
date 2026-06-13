export interface ProxyInput {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
}

export interface ActorInput {
    searchQueries: string[];
    maxResults?: number;
    maxPagesPerQuery?: number;
    proxyConfiguration?: ProxyInput;
}

export interface ProductRecord {
    searchQuery: string;
    position: number;
    productId: string;
    title: string;
    price: number;
    originalPrice: number | null;
    discountPercent: number | null;
    currency: string;
    rating: number | null;
    ordersCount: number | null;
    storeName: string | null;
    imageUrl: string | null;
    productUrl: string;
    scrapedAt: string;
}

export interface RequestData {
    searchQuery: string;
    pageNumber: number;
}
