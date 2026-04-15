// dashboard-src/src/components/internal-admin/InternalUsersTable.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Users,
  DollarSign,
  Activity,
  ExternalLink,
} from "lucide-react";

import { DateRange } from "@/lib/adminApi";
import { useAdminUsers } from "@/hooks/useAdminUsers";

type AnyObj = Record<string, any>;

function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

function formatInt(n: any) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString("es-MX");
}

function formatMoneyMXN(n: any) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "$0";
  return x.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] text-white/75">
      {children}
    </span>
  );
}

function FieldLine({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  const v = String(value || "").trim();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-[11px] text-white/45">{label}</div>
      <div
        className={cx(
          "text-[11px] text-white/75 text-right",
          mono ? "font-mono" : ""
        )}
      >
        {v || "—"}
      </div>
    </div>
  );
}

function SelectionBadge({
  title,
  id,
  name,
}: {
  title: string;
  id?: string;
  name?: string;
}) {
  const has = !!(id || name);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-white/55">{title}</div>
        <span
          className={cx(
            "text-[11px] rounded-xl px-2 py-1 border",
            has
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100/90"
              : "border-white/10 bg-white/[0.04] text-white/55"
          )}
        >
          {has ? "Seleccionado" : "—"}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        <FieldLine label="Nombre" value={name} />
        <FieldLine label="ID" value={id} mono />
      </div>
    </div>
  );
}


function parseSelectedLabel(v: any, opts?: { stripAct?: boolean }) {
  const raw = String(v || "").trim();
  if (!raw) return { id: "", name: "" };

  
  const m = raw.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (m) {
    let id = String(m[1] || "").trim();
    const name = String(m[2] || "").trim();
    if (opts?.stripAct) id = id.replace(/^act_/, "").trim();
    return { id, name };
  }

  
  let idOnly = raw;
  if (opts?.stripAct) idOnly = idOnly.replace(/^act_/, "").trim();
  if (/^(properties\/\d+|\d+)$/.test(idOnly)) {
    return { id: idOnly, name: "" };
  }

  
  return { id: "", name: raw };
}

function pickFirstTruthy(...vals: any[]) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    return v;
  }
  return null;
}

export function InternalUsersTable({
  token,
  range,
}: {
  token: string;
  range: DateRange;
}) {
  const {
    items,
    loading,
    err,
    q,
    setQ,
    limit,
    setLimit,
    hasMore,
    loadMore,
    load,
    safeIsoToLocale,
    metaSpendTotal,
    googleSpendTotal,
    sessionsTotal,
  } = useAdminUsers({ token, range, initialLimit: 50 });

  const [openRow, setOpenRow] = useState<string | null>(null);

  // ✅ Helper: recarga “top newest” SIEMPRE reseteando cursor
  const hardRefresh = async () => {
    setOpenRow(null);
    await load({ reset: true });
  };

  // ✅ Load inicial y cuando cambie el rango/token: SIEMPRE reset
  useEffect(() => {
    hardRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, token]);

  const headerStats = useMemo(() => {
    return {
      users: items.length,
      metaSpend: metaSpendTotal,
      googleSpend: googleSpendTotal,
      sessions: sessionsTotal,
    };
  }, [items.length, metaSpendTotal, googleSpendTotal, sessionsTotal]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-white">
            <Users className="h-4 w-4 text-white/75" />
            <div className="text-sm font-semibold">Usuarios (CRM)</div>
          </div>
          <div className="mt-1 text-xs text-white/45">
            Ventana:{" "}
            <span className="text-white/80">
              {range.from} → {range.to}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Chip>
              <span className="text-white/55">Usuarios:</span>{" "}
              <span className="text-white/85 font-semibold">
                {formatInt(headerStats.users)}
              </span>
            </Chip>
            <Chip>
              <span className="text-white/55">Meta 30D:</span>{" "}
              <span className="text-white/85 font-semibold">
                {formatMoneyMXN(headerStats.metaSpend)}
              </span>
            </Chip>
            <Chip>
              <span className="text-white/55">Google 30D:</span>{" "}
              <span className="text-white/85 font-semibold">
                {formatMoneyMXN(headerStats.googleSpend)}
              </span>
            </Chip>
            <Chip>
              <span className="text-white/55">Sesiones 30D:</span>{" "}
              <span className="text-white/85 font-semibold">
                {formatInt(headerStats.sessions)}
              </span>
            </Chip>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="space-y-1">
            <div className="text-xs text-white/50">Buscar</div>
            <div className="relative">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="email, userId, etc."
                className="w-[240px] pl-10 rounded-2xl border-white/10 bg-white/[0.03] text-white placeholder:text-white/35"
                onKeyDown={(e) => {
                  if (e.key === "Enter") hardRefresh();
                }}
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/45" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-white/50">Límite</div>
            <Input
              value={String(limit)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                const next = Math.max(10, Math.min(200, Math.floor(n)));
                setLimit(next);

                // ✅ cambio de limit => reset
                setTimeout(() => hardRefresh(), 0);
              }}
              className="w-[110px] rounded-2xl border-white/10 bg-white/[0.03] text-white placeholder:text-white/35"
            />
          </div>

          <Button className="rounded-xl" onClick={hardRefresh} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Cargar
          </Button>
        </div>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100/90">
          Error cargando usuarios: {err}
        </div>
      ) : null}

      {/* Table */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#0b1020]/90 backdrop-blur border-b border-white/10">
              <tr className="text-white/60">
                <th className="text-left font-medium p-3">Usuario</th>
                <th className="text-left font-medium p-3">Registro</th>
                <th className="text-left font-medium p-3">Último login</th>
                <th className="text-left font-medium p-3">Meta</th>
                <th className="text-right font-medium p-3">Meta 30D</th>
                <th className="text-left font-medium p-3">Google</th>
                <th className="text-right font-medium p-3">Google 30D</th>
                <th className="text-left font-medium p-3">GA4</th>
                <th className="text-right font-medium p-3">Sesiones 30D</th>
                <th className="text-right font-medium p-3">Acciones</th>
              </tr>
            </thead>

            <tbody>
              {items.map((row: AnyObj, idx: number) => {
                const key =
                  String(row.userId || "").trim() ||
                  String(row.email || "").trim() ||
                  `row_${idx}`;

                const isOpen = openRow === key;

                const registeredIso = pickFirstTruthy(
                  row.registeredAt,
                  row.createdAt,
                  row.created_at
                );

                const metaFromSelected = parseSelectedLabel(row.metaAccountSelected, {
                  stripAct: true,
                });
                const metaId = pickFirstTruthy(row.metaAccountId, metaFromSelected.id);
                const metaName = pickFirstTruthy(row.metaAccountName, metaFromSelected.name);

                const metaLabel =
                  metaName ||
                  (metaId ? `act_${metaId}` : "") ||
                  (row.metaAccountSelected ? String(row.metaAccountSelected) : "");

                const googleFromSelected = parseSelectedLabel(row.googleAdsAccount);
                const googleId = pickFirstTruthy(
                  row.googleAdsCustomerId,
                  googleFromSelected.id
                );
                const googleName = pickFirstTruthy(
                  row.googleAdsAccountName,
                  googleFromSelected.name
                );
                const googleLabel =
                  googleName ||
                  googleId ||
                  (row.googleAdsAccount ? String(row.googleAdsAccount) : "");

                const gaFromSelected = parseSelectedLabel(row.ga4Account);
                const gaId = pickFirstTruthy(row.ga4PropertyId, gaFromSelected.id);
                const gaName = pickFirstTruthy(row.ga4PropertyName, gaFromSelected.name);
                const gaLabel = gaName || gaId || (row.ga4Account ? String(row.ga4Account) : "");

                const sessions30d = Number(
                  pickFirstTruthy(row.ga4Sessions30d, row.gaSessions30d, 0) || 0
                );

                const metaSpend = Number(
                  pickFirstTruthy(row.metaSpend30d, row.metaSpend30D, 0) || 0
                );
                const googleSpend = Number(
                  pickFirstTruthy(row.googleSpend30d, row.googleSpend30D, 0) || 0
                );

                return (
                  <React.Fragment key={key}>
                    <tr className="border-b border-white/10 last:border-b-0 align-top">
                      <td className="p-3">
                        <div className="text-white/90 font-semibold">
                          {row.name || row.email || row.userId || "—"}
                        </div>
                        <div className="text-[11px] text-white/45 font-mono mt-0.5">
                          {row.userId || "—"}
                        </div>
                        {row.email ? (
                          <div className="text-[11px] text-white/55 mt-0.5">
                            {row.email}
                          </div>
                        ) : null}
                      </td>

                      <td className="p-3 text-white/70 whitespace-nowrap">
                        {safeIsoToLocale(registeredIso)}
                      </td>

                      <td className="p-3 text-white/70 whitespace-nowrap">
                        {safeIsoToLocale(row.lastLoginAt)}
                      </td>

                      <td className="p-3 text-white/70">
                        <div className="text-white/80">{metaLabel || "—"}</div>
                        {metaId ? (
                          <div className="text-[11px] text-white/45 font-mono">
                            {metaId}
                          </div>
                        ) : null}
                      </td>

                      <td className="p-3 text-right text-white/85 font-semibold whitespace-nowrap">
                        {formatMoneyMXN(metaSpend)}
                      </td>

                      <td className="p-3 text-white/70">
                        <div className="text-white/80">{googleLabel || "—"}</div>
                        {googleId ? (
                          <div className="text-[11px] text-white/45 font-mono">
                            {googleId}
                          </div>
                        ) : null}
                      </td>

                      <td className="p-3 text-right text-white/85 font-semibold whitespace-nowrap">
                        {formatMoneyMXN(googleSpend)}
                      </td>

                      <td className="p-3 text-white/70">
                        <div className="text-white/80">{gaLabel || "—"}</div>
                        {gaId ? (
                          <div className="text-[11px] text-white/45 font-mono">
                            {gaId}
                          </div>
                        ) : null}
                      </td>

                      <td className="p-3 text-right text-white/85 font-semibold whitespace-nowrap">
                        {formatInt(sessions30d)}
                      </td>

                      <td className="p-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 text-xs text-white/70 hover:text-white"
                          onClick={() => setOpenRow(isOpen ? null : key)}
                        >
                          {isOpen ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                          Detalles
                        </button>
                      </td>
                    </tr>

                    {isOpen ? (
                      <tr className="border-b border-white/10 last:border-b-0">
                        <td colSpan={10} className="p-3">
                          <div className="rounded-2xl border border-white/10 bg-[#0b1020]/55 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-white">
                                Detalles del usuario
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Chip>
                                  <span className="text-white/55">Registro:</span>{" "}
                                  <span className="text-white/85">
                                    {safeIsoToLocale(registeredIso)}
                                  </span>
                                </Chip>
                                <Chip>
                                  <span className="text-white/55">Último login:</span>{" "}
                                  <span className="text-white/85">
                                    {safeIsoToLocale(row.lastLoginAt)}
                                  </span>
                                </Chip>
                                {row.status ? (
                                  <Chip>
                                    <span className="text-white/55">Estado:</span>{" "}
                                    <span className="text-white/85">{row.status}</span>
                                  </Chip>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 lg:grid-cols-3">
                              <SelectionBadge
                                title="Meta seleccionada"
                                id={metaId || undefined}
                                name={metaName || undefined}
                              />
                              <SelectionBadge
                                title="Google Ads seleccionado"
                                id={googleId || undefined}
                                name={googleName || undefined}
                              />
                              <SelectionBadge
                                title="GA4 seleccionada"
                                id={gaId || undefined}
                                name={gaName || undefined}
                              />
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs text-white/55">Meta spend 30D</div>
                                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
                                    <DollarSign className="h-4 w-4 text-white/75" />
                                  </span>
                                </div>
                                <div className="mt-2 text-2xl font-semibold text-white">
                                  {formatMoneyMXN(metaSpend)}
                                </div>
                                <div className="mt-1 text-xs text-white/45">
                                  Gasto aproximado en 30 días
                                </div>
                              </div>

                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs text-white/55">Google spend 30D</div>
                                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
                                    <DollarSign className="h-4 w-4 text-white/75" />
                                  </span>
                                </div>
                                <div className="mt-2 text-2xl font-semibold text-white">
                                  {formatMoneyMXN(googleSpend)}
                                </div>
                                <div className="mt-1 text-xs text-white/45">
                                  Gasto aproximado en 30 días
                                </div>
                              </div>

                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs text-white/55">Sesiones GA4 30D</div>
                                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
                                    <Activity className="h-4 w-4 text-white/75" />
                                  </span>
                                </div>
                                <div className="mt-2 text-2xl font-semibold text-white">
                                  {formatInt(sessions30d)}
                                </div>
                                <div className="mt-1 text-xs text-white/45">
                                  Sesiones estimadas en 30 días
                                </div>
                              </div>
                            </div>

                            {row.raw ? (
                              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs text-white/55">Datos crudos (debug)</div>
                                  <a
                                    className="inline-flex items-center gap-2 text-xs text-white/70 hover:text-white"
                                    href="#"
                                    onClick={(e) => e.preventDefault()}
                                    title="Solo informativo"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    Vista interna
                                  </a>
                                </div>
                                <pre className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-white/70">
                                  {JSON.stringify(row.raw as AnyObj, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}

              {loading ? (
                <tr>
                  <td colSpan={10} className="p-4">
                    <div className="flex items-center gap-2 text-white/70">
                      <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
                    </div>
                  </td>
                </tr>
              ) : null}

              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-4 text-white/55">
                    No hay usuarios en esta ventana.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 p-3">
          <div className="text-xs text-white/45">
            {items.length ? `${items.length} cargados` : "—"}
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.09]"
              onClick={hardRefresh}
              disabled={loading}
            >
              Recargar
            </Button>

            <Button
              className="rounded-xl"
              onClick={() => loadMore()}
              disabled={loading || !hasMore}
            >
              {hasMore ? "Cargar más" : "No hay más"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InternalUsersTable;
