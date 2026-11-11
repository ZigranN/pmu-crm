import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import PrivacyPage, { metadata as privacyMeta } from "@/app/privacy/page";
import TermsPage, { metadata as termsMeta } from "@/app/terms/page";
import DataDeletionPage, { metadata as dataDeletionMeta } from "@/app/data-deletion/page";

describe("Public Legal Routes & Middleware Verification", () => {
  it("allows unauthenticated access to /privacy without redirecting", () => {
    const req = new NextRequest("http://localhost:3000/privacy");
    const res = middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("allows unauthenticated access to /terms without redirecting", () => {
    const req = new NextRequest("http://localhost:3000/terms");
    const res = middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("allows unauthenticated access to /data-deletion without redirecting", () => {
    const req = new NextRequest("http://localhost:3000/data-deletion");
    const res = middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects protected routes to login for unauthenticated users", () => {
    const req = new NextRequest("http://localhost:3000/dashboard");
    const res = middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?callbackUrl=%2Fdashboard");
  });

  it("exports valid SEO metadata for all legal pages", () => {
    expect(privacyMeta.title).toBe("Политика конфиденциальности | PMU CRM");
    expect(privacyMeta.description).toContain("Instagram");

    expect(termsMeta.title).toBe("Условия использования | PMU CRM");
    expect(termsMeta.description).toContain("PMU CRM");

    expect(dataDeletionMeta.title).toBe("Инструкция по удалению данных Meta | PMU CRM");
    expect(dataDeletionMeta.description).toContain("Meta Platforms");
  });

  it("renders page components without runtime errors", () => {
    const privacyElement = PrivacyPage();
    expect(privacyElement).toBeDefined();

    const termsElement = TermsPage();
    expect(termsElement).toBeDefined();

    const dataDeletionElement = DataDeletionPage();
    expect(dataDeletionElement).toBeDefined();
  });
});
