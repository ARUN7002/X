"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Fingerprint,
  Loader2,
  Mic,
  Square,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useToast } from "@/hooks/use-toast";
import { deleteProfile, enrollProfile, getProfiles } from "@/lib/xmux/api";
import { createMicRecorder } from "@/lib/xmux/recorder";
import { useXmux } from "@/lib/xmux/store";
import type { VoiceProfile } from "@/lib/xmux/types";

export function ProfilesView() {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VoiceProfile | null>(null);
  const permissions = useXmux((s) => s.permissions);
  const { toast } = useToast();

  const refresh = () => {
    getProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // initial load without the synchronous setLoading(true) call
    getProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Voice Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Enrolled reference voices used to measure speaker similarity during
            analyses and live sessions.
          </p>
        </div>
        <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
          <DialogTrigger asChild>
            <Button>
              <Fingerprint className="size-4" aria-hidden />
              Enroll Voice Profile
            </Button>
          </DialogTrigger>
          <EnrollDialog
            allowed={permissions.voiceEnrollment}
            onDone={() => {
              setEnrollOpen(false);
              refresh();
              toast({ title: "Voice profile enrolled" });
            }}
          />
        </Dialog>
      </div>

      {!permissions.voiceProfileAccess && (
        <Alert>
          <AlertCircle className="size-4" aria-hidden />
          <AlertTitle>Voice profile access is blocked</AlertTitle>
          <AlertDescription>
            Enable “Voice Profile Access” in Settings to use enrolled profiles.
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading
          profiles…
        </div>
      ) : profiles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <UserRound className="size-6 text-muted-foreground" aria-hidden />
            </span>
            <p className="font-medium">No voice profiles enrolled</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Record or upload 3–60 seconds of a reference voice. Speaker
              similarity in analyses and live sessions is computed against
              these profiles.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {profiles.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <UserRound className="size-5 text-primary" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.duration_sec.toFixed(1)} s · {p.sample_count} sample
                      {p.sample_count === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Enrolled {new Date(p.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => setDeleteTarget(p)}
                >
                  <Trash2 className="size-4 text-muted-foreground" aria-hidden />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete voice profile?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” will be removed permanently. Analyses that
              already used it keep their recorded results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleteTarget) {
                  try {
                    await deleteProfile(deleteTarget.id);
                    toast({ title: "Profile deleted" });
                  } catch {
                    toast({ title: "Could not delete profile", variant: "destructive" });
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

function EnrollDialog({
  allowed,
  onDone,
}: {
  allowed: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<ReturnType<typeof createMicRecorder> | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  const start = async () => {
    setError(null);
    const recorder = createMicRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError(
        recorder.state === "BLOCKED"
          ? "Microphone permission was denied."
          : "The microphone could not be started.",
      );
    }
  };

  const submitBlob = async (blob: Blob) => {
    if (!name.trim()) {
      setError("Enter a name for this profile.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await enrollProfile(blob, name.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "enrollment failed");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (timerRef.current) window.clearInterval(timerRef.current);
    setRecording(false);
    try {
      const { blob, durationSec } = await recorder.stop();
      if (durationSec < 3) {
        setError("Enrollment needs at least 3 seconds of speech.");
        return;
      }
      await submitBlob(blob);
    } catch {
      setError("Recording failed.");
    }
  };

  if (!allowed) {
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Voice enrollment is blocked</DialogTitle>
          <DialogDescription>
            Enable “Voice Enrollment” in Settings to enroll reference voices.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    );
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Enroll a voice profile</DialogTitle>
        <DialogDescription>
          Record or upload 3–60 seconds of the reference voice speaking
          naturally. A speaker embedding is extracted and stored on the
          backend.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="profile-name">Profile name</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Primary contact"
            maxLength={80}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {recording ? (
            <Button variant="destructive" onClick={stop}>
              <Square className="size-4" aria-hidden />
              Stop & Save ({seconds}s)
            </Button>
          ) : (
            <Button onClick={start} disabled={busy}>
              <Mic className="size-4" aria-hidden />
              Record Reference
            </Button>
          )}
          <span className="text-xs text-muted-foreground">or</span>
          <input
            ref={fileRef}
            type="file"
            accept=".wav,.wave,.mp3,.flac,.ogg,.oga,.m4a,.mp4,.webm,.aac,.opus,.wma,.aiff,.aif,audio/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void submitBlob(file);
              e.target.value = "";
            }}
          />
          <Button variant="outline" disabled={busy || recording} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden />
            Upload Audio
          </Button>
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
