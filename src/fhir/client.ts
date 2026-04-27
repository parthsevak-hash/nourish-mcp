/**
 * Minimal FHIR R4 client. We do not persist any patient data on the
 * Nourish side. Every read goes through the FHIR server URL and access
 * token that Prompt Opinion injected into the request.
 */

import type { SharpContext } from "../sharp/context.js";

export class FhirClient {
  constructor(private readonly ctx: SharpContext) {
    if (!ctx.fhirServerUrl) {
      throw new Error(
        "FHIR server URL missing from SHARP context. Was the server registered without the FHIR extension authorized?"
      );
    }
  }

  async read(resourceType: string, id: string): Promise<any> {
    return this.request(`${resourceType}/${id}`, "GET");
  }

  async search(
    resourceType: string,
    params: Record<string, string | number | boolean | undefined>
  ): Promise<any> {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      search.set(k, String(v));
    }
    return this.request(`${resourceType}?${search.toString()}`, "GET");
  }

  async create(resourceType: string, body: any): Promise<any> {
    return this.request(resourceType, "POST", body);
  }

  async update(resourceType: string, id: string, body: any): Promise<any> {
    return this.request(`${resourceType}/${id}`, "PUT", body);
  }

  private async request(path: string, method: string, body?: any): Promise<any> {
    const url = `${this.ctx.fhirServerUrl!.replace(/\/$/, "")}/${path}`;
    const headers: Record<string, string> = {
      Accept: "application/fhir+json",
    };
    if (body) headers["Content-Type"] = "application/fhir+json";
    if (this.ctx.fhirAccessToken) {
      headers.Authorization = `Bearer ${this.ctx.fhirAccessToken}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`FHIR ${method} ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }
}
