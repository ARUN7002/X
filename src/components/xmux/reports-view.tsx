"use client";

import { useEffect, useState } from "react";
import {
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { deleteReport, getReport, getReports } from "@/lib/xmux/api";
import type { AnalysisResult, ReportSummary } from "@/lib/xmux/types";
import { ResultPanel } from "./result-panel";
import { ActionBadge, VerdictBadge, pct } from "./status-badge";

export function ReportsView() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AnalysisResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReportSummary | null>(null);
  const { toast } = useToast();

  const refresh = () => {
    setLoading(true);
    getReports()
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const report = await getReport(id);
      setDetail(report);
    } catch {
      toast({ title: "Could not load report", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Stored analyses with their evidence, verdicts and model versions.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Analysis History</CardTitle>
          <CardDescription>
            {reports.length} stored {reports.length === 1 ? "analysis" : "analyses"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading
              reports…
            </div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                <FileText className="size-6 text-muted-foreground" aria-hidden />
              </span>
              <p className="font-medium">No reports yet</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Completed analyses appear here with their full evidence trail.
              </p>
            </div>
          ) : (
            <ScrollArea className="xmux-scroll max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="max-w-32 truncate">Audio</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead className="text-right">AI Likelihood</TableHead>
                    <TableHead className="text-right">Risk</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => void openDetail(r.id)}
                    >
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.source === "MICROPHONE" ? "Microphone" : r.source}
                      </TableCell>
                      <TableCell className="max-w-32 truncate text-xs">
                        {r.label ?? "—"}
                      </TableCell>
                      <TableCell>
                        <VerdictBadge verdict={r.verdict} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {r.synthetic_evidence === null ? "—" : pct(r.synthetic_evidence)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {r.risk_score === null ? "—" : pct(r.risk_score)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {r.confidence === null ? "—" : pct(r.confidence)}
                      </TableCell>
                      <TableCell>
                        <ActionBadge action={r.recommended_action} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete report"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(r);
                            }}
                          >
                            <Trash2 className="size-4 text-muted-foreground" aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={detail !== null || detailLoading} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[85vh] overflow-y-auto xmux-scroll sm:max-w-3xl"
        >
          <DialogHeader>
            <DialogTitle>Analysis Report</DialogTitle>
            {detail && (
              <DialogDescription>
                {detail.label ?? "audio"} · analyzed{" "}
                {new Date(detail.meta.created_at).toLocaleString()} · model{" "}
                {detail.model.synthetic_detection ?? "unavailable"}
              </DialogDescription>
            )}
          </DialogHeader>
          {detailLoading && (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading
              report…
            </div>
          )}
          {detail && <ResultPanel result={detail} />}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>
              The stored analysis and its evidence will be removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleteTarget) {
                  try {
                    await deleteReport(deleteTarget.id);
                    toast({ title: "Report deleted" });
                  } catch {
                    toast({ title: "Could not delete report", variant: "destructive" });
                  }
                  setDeleteTarget(null);
                  refresh();
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
