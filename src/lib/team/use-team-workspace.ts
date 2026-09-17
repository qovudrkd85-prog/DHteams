"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount } from "@/components/account/provider";
import {
  checkIn, checkOut, listAttendance, listTeamMembers, officeDateKey,
  type Attendance, type TeamMember,
} from "@/lib/team/workspace";

const message = (error: unknown) => error instanceof Error ? error.message : "팀 정보를 불러오지 못했습니다.";

export function useTeamWorkspace() {
  const { account, settingsOpen: profileOpen, setSettingsOpen: setProfileOpen } = useAccount();
  const [people, setMembers] = useState<TeamMember[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => officeDateKey());
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const mutating = useRef(false);
  const invalidate = useCallback(() => { ++version.current; }, []);

  const refresh = useCallback(() => {
    if (mutating.current) return Promise.resolve();
    const request = ++version.current;
    const day = officeDateKey();
    return Promise.all([listTeamMembers(), listAttendance(day)]).then(([people, records]) => {
      if (request !== version.current) return;
      setMembers(people);
      setAttendance(records);
      setError(null);
    }).catch((err: unknown) => {
      if (request === version.current) setError(message(err));
    }).finally(() => {
      if (request === version.current) {
        setToday(day);
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(onVisible, 30000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      invalidate();
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, invalidate]);

  const currentMember = account?.member ?? null;
  // Profile changes appear immediately everywhere while the shared roster refreshes.
  const members = useMemo(() => {
    if (!currentMember) return people;
    return people.some((person) => person.id === currentMember.id)
      ? people.map((person) => person.id === currentMember.id ? currentMember : person)
      : [...people, currentMember];
  }, [people, currentMember]);
  const todaysAttendance = attendance.filter((record) => record.work_date === today);
  const myAttendance = todaysAttendance.find((record) => record.member_id === currentMember?.id) ?? null;

  const markAttendance = async () => {
    if (!currentMember?.profile_completed || mutating.current || loading || error) return;
    const day = officeDateKey();
    if (day !== today) {
      toast.info("날짜가 바뀌어 오늘의 출퇴근 상태를 다시 확인합니다. 갱신 후 눌러 주세요.");
      await refresh();
      return;
    }
    const record = attendance.find((row) => row.member_id === currentMember.id && row.work_date === day);
    if (record?.checked_out_at) return;
    mutating.current = true;
    ++version.current;
    setBusy(true);
    try {
      const saved = record ? await checkOut(record) : await checkIn(currentMember.id);
      setToday(saved.work_date);
      setAttendance((prev) => [...prev.filter((row) => row.id !== saved.id), saved]);
      toast.success(record ? "오늘도 수고했어요. 퇴근을 기록했습니다." : "좋은 하루예요! 출근을 기록했습니다.");
    } catch (err) {
      toast.error(message(err));
    } finally {
      mutating.current = false;
      setBusy(false);
      void refresh();
    }
  };

  return { members, attendance: todaysAttendance, currentMember, myAttendance, loading, error, today, busy, profileOpen, setProfileOpen, refresh, markAttendance };
}

export type TeamWorkspaceState = ReturnType<typeof useTeamWorkspace>;
