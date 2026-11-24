import React, { useCallback, useEffect, useState } from 'react';
import { Check, Megaphone, Send, Shield, Sliders, Trash2, UserX, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ModerationReport, UserProfile } from '../types';
import {
  adminDeletePostById,
  adminToggleUserSuspension,
  fetchAdminActivityOverview,
  fetchAllReports,
  savePlatformSettings,
  updateReportStatus,
} from '../services/socialService';
import {
  APP_NOTIFICATION_LOGO_URL,
  APP_NOTIFICATION_SENDER_NAME,
  sendAdminAnnouncement,
} from '../services/notificationService';
import { Avatar } from '../components/Avatar';
import { formatRelativeTime } from '../utils/formatters';

export function AdminPage() {
  const { profile, isAdmin, platformSettings, refreshPlatformSettings } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'reports' | 'members' | 'announcements' | 'settings'>('reports');
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [postsSampled, setPostsSampled] = useState(0);
  const [loading, setLoading] = useState(true);

  // Announcement broadcast form
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);

  // Platform config form
  const [maxUploadSizeMB, setMaxUploadSizeMB] = useState(platformSettings.maxUploadSizeMB);
  const [allowNewRegistrations, setAllowNewRegistrations] = useState(
    platformSettings.allowNewRegistrations
  );
  const [maintenanceNotice, setMaintenanceNotice] = useState(platformSettings.maintenanceNotice);
  const [hashtagsCsv, setHashtagsCsv] = useState(platformSettings.featuredHashtags.join(', '));
  const [savingSettings, setSavingSettings] = useState(false);

  const loadAdminData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [reportList, overview] = await Promise.all([
        fetchAllReports(),
        fetchAdminActivityOverview(),
      ]);
      setReports(reportList);
      setMembers(overview.users);
      setPostsSampled(overview.totalPostsSampled);
    } catch {
      showToast({ type: 'error', title: 'Could not load moderation console' });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, showToast]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  useEffect(() => {
    setMaxUploadSizeMB(platformSettings.maxUploadSizeMB);
    setAllowNewRegistrations(platformSettings.allowNewRegistrations);
    setMaintenanceNotice(platformSettings.maintenanceNotice);
    setHashtagsCsv(platformSettings.featuredHashtags.join(', '));
  }, [platformSettings]);

  if (!isAdmin) {
    return (
      <div className="max-w-lg mx-auto bg-surface-2 border border-hairline rounded-2xl p-10 text-center">
        <Shield className="w-8 h-8 text-rose-400 mx-auto" />
        <h1 className="mt-3 font-display text-xl font-bold text-ink-2">Access Restricted</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Administrator privileges are required to view community moderation tools.
        </p>
      </div>
    );
  }

  const handleResolveReport = async (report: ModerationReport, removeTargetPost: boolean) => {
    if (!profile) return;
    try {
      if (removeTargetPost && report.targetType === 'post') {
        await adminDeletePostById(report.targetId);
      }
      await updateReportStatus(report.id, 'resolved', profile.uid);
      setReports((prev) =>
        prev.map((r) =>
          r.id === report.id ? { ...r, status: 'resolved', reviewedBy: profile.uid } : r
        )
      );
      showToast({
        type: 'success',
        title: removeTargetPost ? 'Post removed & report resolved' : 'Report marked resolved',
      });
    } catch {
      showToast({ type: 'error', title: 'Action failed' });
    }
  };

  const handleDismissReport = async (report: ModerationReport) => {
    if (!profile) return;
    try {
      await updateReportStatus(report.id, 'dismissed', profile.uid);
      setReports((prev) =>
        prev.map((r) =>
          r.id === report.id ? { ...r, status: 'dismissed', reviewedBy: profile.uid } : r
        )
      );
      showToast({ type: 'info', title: 'Report dismissed' });
    } catch {
      showToast({ type: 'error', title: 'Could not dismiss report' });
    }
  };

  const handleToggleSuspend = async (member: UserProfile) => {
    const nextSuspended = !member.isSuspended;
    try {
      await adminToggleUserSuspension(member.uid, nextSuspended);
      setMembers((prev) =>
        prev.map((m) => (m.uid === member.uid ? { ...m, isSuspended: nextSuspended } : m))
      );
      showToast({
        type: 'success',
        title: nextSuspended ? `@${member.username} suspended` : `@${member.username} reinstated`,
      });
    } catch {
      showToast({ type: 'error', title: 'Could not update suspension state' });
    }
  };

  const handleSavePlatformSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingSettings(true);
    try {
      const tags = hashtagsCsv
        .split(',')
        .map((t) => t.trim().replace(/^#/, '').toLowerCase())
        .filter(Boolean)
        .slice(0, 10);
      await savePlatformSettings(profile.uid, {
        maxUploadSizeMB,
        allowNewRegistrations,
        maintenanceNotice,
        featuredHashtags: tags,
      });
      await refreshPlatformSettings();
      showToast({ type: 'success', title: 'Platform settings saved' });
    } catch {
      showToast({ type: 'error', title: 'Could not save platform settings' });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSendAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || sendingAnnouncement) return;
    setSendingAnnouncement(true);
    try {
      const count = await sendAdminAnnouncement({
        adminProfile: profile,
        title: announcementTitle,
        body: announcementBody,
      });
      setAnnouncementTitle('');
      setAnnouncementBody('');
      showToast({
        type: 'success',
        title: 'Announcement published',
        description:
          count > 0
            ? `Delivered in-app notification to ${count} active member${count === 1 ? '' : 's'}.`
            : 'No active recipient accounts found yet.',
      });
    } catch {
      showToast({ type: 'error', title: 'Could not send announcement' });
    } finally {
      setSendingAnnouncement(false);
    }
  };

  const openReportsCount = reports.filter((r) => r.status === 'open').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-2">
            Administration & Safety
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Moderate reports, manage member access, and configure platform controls
          </p>
        </div>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface-2 border border-hairline rounded-2xl p-5">
          <p className="text-xs text-ink-muted">Open Reports</p>
          <p className="mt-1 font-mono text-2xl font-bold text-accent-strong tabular-nums">
            {openReportsCount}
          </p>
        </div>
        <div className="bg-surface-2 border border-hairline rounded-2xl p-5">
          <p className="text-xs text-ink-muted">Active Members Sampled</p>
          <p className="mt-1 font-mono text-2xl font-bold text-ink-2 tabular-nums">
            {members.length}
          </p>
        </div>
        <div className="bg-surface-2 border border-hairline rounded-2xl p-5">
          <p className="text-xs text-ink-muted">Recent Posts Indexed</p>
          <p className="mt-1 font-mono text-2xl font-bold text-ink-2 tabular-nums">
            {postsSampled}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-surface-2 rounded-xl border border-hairline">
        {(
          [
            { id: 'reports', label: 'Reported Content' },
            { id: 'members', label: 'Member Activity' },
            { id: 'announcements', label: 'Announcements' },
            { id: 'settings', label: 'Platform Settings' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === item.id
                ? 'bg-accent-strong text-accent-fg'
                : 'text-ink-muted hover:text-ink-2'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-48 rounded-2xl bg-surface-2 border border-hairline animate-pulse" />
      ) : tab === 'reports' ? (
        <div className="space-y-3">
          {reports.length === 0 ? (
            <div className="bg-surface-2 border border-hairline rounded-2xl p-10 text-center">
              <p className="text-sm text-ink-muted">No moderation reports have been filed.</p>
            </div>
          ) : (
            reports.map((report) => (
              <div
                key={report.id}
                className="bg-surface-2 border border-hairline rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-ink-2">
                    {report.reason} ·{' '}
                    <span className="text-xs font-normal text-ink-muted">
                      {report.targetType} ({report.targetId})
                    </span>
                  </p>
                  {report.details && (
                    <p className="text-xs text-ink-muted leading-relaxed">{report.details}</p>
                  )}
                  <p className="text-[11px] text-ink-subtle">
                    Status: <strong className="text-accent-strong">{report.status}</strong> ·{' '}
                    {formatRelativeTime(report.createdAt)}
                  </p>
                </div>

                {report.status === 'open' && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {report.targetType === 'post' && (
                      <button
                        type="button"
                        onClick={() => handleResolveReport(report, true)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500 inline-flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove Post</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleResolveReport(report, false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-accent-strong/40 text-accent-strong hover:bg-accent-strong/10 inline-flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Resolve</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDismissReport(report)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-hairline text-ink-muted hover:text-ink-2 inline-flex items-center gap-1.5"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Dismiss</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : tab === 'members' ? (
        <div className="bg-surface-2 border border-hairline rounded-2xl divide-y divide-hairline overflow-hidden">
          {members.map((m) => (
            <div
              key={m.uid}
              className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar src={m.avatarUrl} name={m.fullName} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-2 truncate">
                    {m.fullName}{' '}
                    <span className="text-xs font-normal text-ink-muted">@{m.username}</span>
                  </p>
                  <p className="text-xs text-ink-subtle font-mono tabular-nums">
                    {m.postsCount} posts · {m.followersCount} followers ·{' '}
                    {m.isSuspended ? 'Suspended' : 'Active'}
                  </p>
                </div>
              </div>

              {m.uid !== profile?.uid && (
                <button
                  type="button"
                  onClick={() => handleToggleSuspend(m)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 self-start sm:self-auto ${
                    m.isSuspended
                      ? 'border border-accent-strong/40 text-accent-strong hover:bg-accent-strong/10'
                      : 'bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
                  }`}
                >
                  <UserX className="w-3.5 h-3.5" />
                  <span>{m.isSuspended ? 'Reinstate' : 'Suspend'}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      ) : tab === 'announcements' ? (
        <form
          onSubmit={handleSendAnnouncement}
          className="bg-surface-2 border border-hairline rounded-2xl p-6 space-y-5 max-w-xl"
        >
          <div className="flex items-center gap-3 pb-3 border-b border-hairline">
            <img
              src={APP_NOTIFICATION_LOGO_URL}
              alt={APP_NOTIFICATION_SENDER_NAME}
              className="w-10 h-10 rounded-xl object-cover border border-accent/45 bg-canvas shrink-0"
            />
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-ink-2">
                Official App Notification
              </h2>
              <p className="text-xs text-ink-muted">
                Sent from <span className="text-accent font-semibold">{APP_NOTIFICATION_SENDER_NAME}</span> with the app logo — never your personal profile photo
              </p>
            </div>
          </div>

          <label className="block text-xs font-medium text-ink-muted">
            Notification Title
            <input
              type="text"
              required
              maxLength={120}
              value={announcementTitle}
              onChange={(e) => setAnnouncementTitle(e.target.value)}
              placeholder="e.g., Campus Photography Contest This Friday"
              className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
            />
          </label>

          <label className="block text-xs font-medium text-ink-muted">
            Notification Message
            <textarea
              rows={4}
              required
              maxLength={260}
              value={announcementBody}
              onChange={(e) => setAnnouncementBody(e.target.value)}
              placeholder="Write a clear, helpful message from Hostel Friend..."
              className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong resize-none"
            />
          </label>

          {/* Live Member Inbox Preview */}
          <div className="rounded-xl bg-canvas-alt border border-hairline p-3.5 space-y-2">
            <p className="text-[11px] font-mono uppercase tracking-wider text-ink-subtle">
              Member Inbox Preview
            </p>
            <div className="flex items-start gap-3">
              <div className="relative shrink-0">
                <img
                  src={APP_NOTIFICATION_LOGO_URL}
                  alt={APP_NOTIFICATION_SENDER_NAME}
                  className="w-10 h-10 rounded-xl object-cover border border-accent/45 bg-surface-2"
                />
                <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-br from-accent-soft to-accent-deep flex items-center justify-center shadow-sm">
                  <Megaphone className="w-3 h-3 text-accent-fg" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wider text-accent flex flex-wrap items-center gap-1.5">
                  <span>{APP_NOTIFICATION_SENDER_NAME}</span>
                  {announcementTitle.trim() && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="normal-case tracking-normal font-semibold text-ink-2">
                        {announcementTitle.trim()}
                      </span>
                    </>
                  )}
                </p>
                <p className="text-xs text-ink-muted mt-0.5 leading-relaxed break-words">
                  {announcementBody.trim() ||
                    'Your notification message will appear here under the Hostel Friend app logo.'}
                </p>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={sendingAnnouncement || !announcementTitle.trim() || !announcementBody.trim()}
            className="gold-gradient-btn px-5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{sendingAnnouncement ? 'Sending...' : 'Send App Notification'}</span>
          </button>
        </form>
      ) : (
        <form
          onSubmit={handleSavePlatformSettings}
          className="bg-surface-2 border border-hairline rounded-2xl p-6 space-y-5 max-w-xl"
        >
          <div className="flex items-center gap-2.5 pb-2 border-b border-hairline">
            <Sliders className="w-4 h-4 text-accent-strong" />
            <h2 className="font-display text-base font-semibold text-ink-2">
              Global Platform Settings
            </h2>
          </div>

          <label className="block text-xs font-medium text-ink-muted">
            Max Upload Size (MB, 1–100)
            <input
              type="number"
              min={1}
              max={100}
              value={maxUploadSizeMB}
              onChange={(e) => setMaxUploadSizeMB(Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
            />
          </label>

          <label className="flex items-center justify-between gap-4 cursor-pointer py-1">
            <span className="text-sm text-ink-2">Allow New Member Registrations</span>
            <input
              type="checkbox"
              checked={allowNewRegistrations}
              onChange={(e) => setAllowNewRegistrations(e.target.checked)}
              className="w-4 h-4 accent-accent-strong"
            />
          </label>

          <label className="block text-xs font-medium text-ink-muted">
            Community Announcement Banner (optional)
            <input
              type="text"
              maxLength={240}
              value={maintenanceNotice}
              onChange={(e) => setMaintenanceNotice(e.target.value)}
              placeholder="Leave blank to hide banner"
              className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
            />
          </label>

          <label className="block text-xs font-medium text-ink-muted">
            Featured Hashtags (comma separated)
            <input
              type="text"
              value={hashtagsCsv}
              onChange={(e) => setHashtagsCsv(e.target.value)}
              className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
            />
          </label>

          <button
            type="submit"
            disabled={savingSettings}
            className="gold-gradient-btn px-5 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50"
          >
            {savingSettings ? 'Saving...' : 'Save Platform Settings'}
          </button>
        </form>
      )}
    </div>
  );
}
