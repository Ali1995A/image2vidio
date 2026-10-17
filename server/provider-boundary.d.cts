export function providerConfig(body: Record<string, unknown>): {baseUrl: string; apiKey: string};
export function isSignedMedia(url: string): boolean;
export function mediaUrl(url: string): URL;
export function providerFetch(url: string, init?: RequestInit): Promise<Response>;
export function downloadFetch(url: string, apiKey: string): Promise<Response>;
