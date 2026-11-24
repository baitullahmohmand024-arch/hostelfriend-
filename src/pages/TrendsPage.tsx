import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpRight, Clock, Flame, Hash, RefreshCw, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { Post } from '../types';
import { fetchTrendsSample } from '../services/postService';
import { isLegacyPollPost } from '../services/pollService';
import { formatCount } from '../utils/formatters';
import {
  computeCommunityTrends,
  TrendsMediaFilter,
  TrendsTimeframe,
} from '../utils/trendsAnalytics';

interface TrendsPageProps {
  onSearchHashtag: (tag: string) => void;
  onNavigateCreate?: () => void;
}

interface CustomTooltipPayloadItem {
  name?: string;
  value?: number;
  color?: string;
  payload?: Record<string, unknown>;
}

interface CustomChartTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayloadItem[];
  label?: string;
}

function HashtagTooltip({ active, payload }: CustomChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload as
    | {
        label?: string;
        posts?: number;
        likes?: number;
        comments?: number;
        engagement?: number;
        sharePct?: number;
      }
    | undefined;
  if (!item) return null;

  return (
    <div className="bg-canvas-alt/95 border border-hairline-strong rounded-xl px-3.5 py-2.5 shadow-xl text-xs">
      <p className="font-display font-semibold text-accent-strong">{item.label}</p>
      <div className="mt-1.5 space-y-1 text-ink-muted font-mono tabular-nums">
        <div className="flex items-center justify-between gap-5">
          <span>Posts</span>
          <span className="text-ink-2 font-semibold">{formatCount(item.posts || 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span>Likes</span>
          <span className="text-ink-2">{formatCount(item.likes || 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span>Comments</span>
          <span className="text-ink-2">{formatCount(item.comments || 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-5 pt-1 border-t border-hairline">
          <span>Engagement</span>
          <span className="text-accent-soft font-semibold">{formatCount(item.engagement || 0)}</span>
        </div>
      </div>
    </div>
  );
}

function ActivityTooltip({ active, payload, label }: CustomChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as
    | {
        label?: string;
        posts?: number;
        engagement?: number;
        likes?: number;
        comments?: number;
      }
    | undefined;
  if (!point) return null;

  return (
    <div className="bg-canvas-alt/95 border border-hairline-strong rounded-xl px-3.5 py-2.5 shadow-xl text-xs">
      <p className="font-display font-semibold text-ink-2">{point.label || label}</p>
      <div className="mt-1.5 space-y-1 text-ink-muted font-mono tabular-nums">
        <div className="flex items-center justify-between gap-5">
          <span className="text-accent-strong">Posts</span>
          <span className="text-ink-2 font-semibold">{formatCount(point.posts || 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span>Interactions</span>
          <span className="text-ink-2 font-semibold">{formatCount(point.engagement || 0)}</span>
        </div>
      </div>
    </div>
  );
}

export function TrendsPage({ onSearchHashtag, onNavigateCreate }: TrendsPageProps) {
  const { privateSettings } = useAuth();
  const { activeTheme } = useTheme();
  const { showToast } = useToast();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [timeframe, setTimeframe] = useState<TrendsTimeframe>('all');
  const [mediaFilter, setMediaFilter] = useState<TrendsMediaFilter>('all');
  const [hashtagMetric, setHashtagMetric] = useState<'posts' | 'engagement'>('posts');
  const [activityView, setActivityView] = useState<'hourly' | 'weekday'>('hourly');

  const blockedSet = useMemo(
    () => new Set(privateSettings?.blockedUserIds || []),
    [privateSettings]
  );

  const loadTrends = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setErrorMsg('');
      try {
        const sampled = await fetchTrendsSample(100);
        setPosts(sampled);
      } catch {
        setErrorMsg('Could not load community trends right now.');
        showToast({ type: 'error', title: 'Could not load trends' });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    loadTrends(false);
  }, [loadTrends]);

  const visiblePosts = useMemo(
    () => posts.filter((p) => !blockedSet.has(p.authorId) && !isLegacyPollPost(p)),
    [posts, blockedSet]
  );

  const summary = useMemo(
    () =>
      computeCommunityTrends(visiblePosts, {
        timeframe,
        mediaFilter,
      }),
    [visiblePosts, timeframe, mediaFilter]
  );

  const rankedHashtags = useMemo(() => {
    const list = [...summary.topHashtags];
    if (hashtagMetric === 'engagement') {
      list.sort((a, b) => b.engagement - a.engagement || b.posts - a.posts);
    } else {
      list.sort((a, b) => b.posts - a.posts || b.engagement - a.engagement);
    }
    return list.slice(0, 8);
  }, [summary.topHashtags, hashtagMetric]);

  const localTimezoneLabel = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local Time';
    } catch {
      return 'Local Time';
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-2">
            Community Trends
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Popular hashtags and peak posting &amp; engagement hours across Hostel Friend
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Timeframe Selector */}
          <div className="inline-flex items-center gap-1 p-1 glass-card rounded-xl">
            {(
              [
                { id: 'all', label: 'Recent 100' },
                { id: '7d', label: '7 Days' },
                { id: '24h', label: '24 Hours' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTimeframe(opt.id)}
                className={`hf-press px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
                  timeframe === opt.id
                    ? 'bg-accent-strong text-accent-fg shadow-sm'
                    : 'text-ink-muted hover:text-ink-2'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Media Type Filter */}
          <div className="inline-flex items-center gap-1 p-1 glass-card rounded-xl">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'image', label: 'Photos' },
                { id: 'video', label: 'Videos' },
                { id: 'text', label: 'Notes' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMediaFilter(opt.id)}
                className={`hf-press px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
                  mediaFilter === opt.id
                    ? 'bg-hover-tint text-ink-2'
                    : 'text-ink-muted hover:text-ink-2'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={loading || refreshing}
            onClick={() => loadTrends(true)}
            className="glass-btn px-3.5 py-2 rounded-xl text-xs font-medium text-ink-2 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-accent-strong ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px glass-card rounded-2xl overflow-hidden">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-hover-tint/50 animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-6 h-88 rounded-2xl glass-card animate-pulse" />
            <div className="lg:col-span-6 h-88 rounded-2xl glass-card animate-pulse" />
          </div>
        </div>
      ) : errorMsg ? (
        <div className="glass-card rounded-2xl p-10 text-center">
          <p className="font-display text-base font-semibold text-ink-2">{errorMsg}</p>
          <button
            type="button"
            onClick={() => loadTrends(false)}
            className="mt-4 gold-gradient-btn px-5 py-2 rounded-xl text-xs font-semibold"
          >
            Try Again
          </button>
        </div>
      ) : summary.totalPosts === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <TrendingUp className="w-8 h-8 text-accent-strong mx-auto" />
          <h2 className="mt-3 font-display text-lg font-semibold text-ink-2">
            No posts found for this filter
          </h2>
          <p className="mt-1.5 text-xs text-ink-muted max-w-md mx-auto">
            Widen the timeframe or media filter to inspect hashtag momentum and hourly activity.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            {(timeframe !== 'all' || mediaFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setTimeframe('all');
                  setMediaFilter('all');
                }}
                className="glass-btn px-4 py-2 rounded-xl text-xs font-semibold text-ink-2"
              >
                Reset Filters
              </button>
            )}
            {onNavigateCreate && (
              <button
                type="button"
                onClick={onNavigateCreate}
                className="gold-gradient-btn px-4 py-2 rounded-xl text-xs font-semibold"
              >
                Share a Post
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Single-Elevation KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-hairline glass-card rounded-2xl overflow-hidden">
            <div className="p-5">
              <p className="text-xs text-ink-muted">Posts Analyzed</p>
              <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-ink-2">
                {formatCount(summary.totalPosts)}
              </p>
              <p className="mt-1 text-[11px] text-ink-subtle font-mono tabular-nums">
                {summary.uniqueHashtags} active hashtags
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs text-ink-muted">Leading Hashtag</p>
              {summary.topHashtags[0] ? (
                <>
                  <button
                    type="button"
                    onClick={() => onSearchHashtag(summary.topHashtags[0].tag)}
                    className="hf-press mt-1.5 font-display text-xl font-bold text-accent-strong hover:text-accent-soft truncate block max-w-full text-left"
                  >
                    {summary.topHashtags[0].label}
                  </button>
                  <p className="mt-1 text-[11px] text-ink-subtle font-mono tabular-nums">
                    {summary.topHashtags[0].posts} posts · {summary.topHashtags[0].sharePct}% of feed
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1.5 font-display text-xl font-semibold text-ink-subtle">—</p>
                  <p className="mt-1 text-[11px] text-ink-subtle">No hashtags tagged yet</p>
                </>
              )}
            </div>

            <div className="p-5">
              <p className="text-xs text-ink-muted">Peak Activity Hour</p>
              <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-ink-2">
                {summary.peakHour ? summary.peakHour.label : '—'}
              </p>
              <p className="mt-1 text-[11px] text-ink-subtle font-mono tabular-nums truncate">
                {summary.peakHour
                  ? `${summary.peakHour.posts} posts · ${formatCount(summary.peakHour.engagement)} interactions`
                  : localTimezoneLabel}
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs text-ink-muted">Community Engagement</p>
              <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-ink-2">
                {formatCount(summary.totalEngagement)}
              </p>
              <p className="mt-1 text-[11px] text-ink-subtle font-mono tabular-nums">
                {formatCount(summary.totalLikes)} likes · {formatCount(summary.totalComments)} comments
              </p>
            </div>
          </div>

          {/* Primary Recharts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Chart 1: Popular Hashtags */}
            <section className="lg:col-span-6 glass-card rounded-2xl p-5 flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-hairline">
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-accent-strong" />
                  <div>
                    <h2 className="font-display text-base font-semibold text-ink-2">
                      Most Popular Hashtags
                    </h2>
                    <p className="text-[11px] text-ink-subtle">
                      Click any bar to explore posts with that tag
                    </p>
                  </div>
                </div>

                <div className="inline-flex items-center gap-1 p-1 bg-canvas-alt rounded-lg border border-hairline">
                  <button
                    type="button"
                    onClick={() => setHashtagMetric('posts')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      hashtagMetric === 'posts'
                        ? 'bg-accent-strong text-accent-fg'
                        : 'text-ink-muted hover:text-ink-2'
                    }`}
                  >
                    Posts
                  </button>
                  <button
                    type="button"
                    onClick={() => setHashtagMetric('engagement')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      hashtagMetric === 'engagement'
                        ? 'bg-accent-strong text-accent-fg'
                        : 'text-ink-muted hover:text-ink-2'
                    }`}
                  >
                    Engagement
                  </button>
                </div>
              </div>

              {rankedHashtags.length === 0 ? (
                <div className="flex-1 min-h-[280px] flex flex-col items-center justify-center text-center p-6">
                  <p className="text-sm font-medium text-ink-2">No hashtags in this sample</p>
                  <p className="mt-1 text-xs text-ink-subtle max-w-xs">
                    Add #hashtags to captions when sharing posts to surface trending topics here.
                  </p>
                </div>
              ) : (
                <div className="mt-4 h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={rankedHashtags}
                      layout="vertical"
                      margin={{ top: 4, right: 20, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid
                        stroke={activeTheme.chartGridColor}
                        strokeDasharray="3 3"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        stroke={activeTheme.chartAxisColor}
                        tick={{ fill: activeTheme.chartAxisColor, fontSize: 11 }}
                        axisLine={{ stroke: activeTheme.chartGridColor }}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={116}
                        stroke={activeTheme.chartAxisColor}
                        tick={{ fill: activeTheme.swatches.text, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{
                          fill: activeTheme.isLight
                            ? 'rgba(180, 123, 0, 0.08)'
                            : 'rgba(255, 255, 255, 0.06)',
                        }}
                        content={<HashtagTooltip />}
                      />
                      <Bar
                        dataKey={hashtagMetric}
                        radius={[0, 6, 6, 0]}
                        barSize={20}
                        className="cursor-pointer"
                        onClick={(data) => {
                          const tag = (data as { tag?: string })?.tag;
                          if (tag) onSearchHashtag(tag);
                        }}
                      >
                        {rankedHashtags.map((entry, idx) => (
                          <Cell
                            key={entry.tag}
                            fill={
                              idx === 0
                                ? activeTheme.accentSoftHex
                                : idx <= 2
                                ? activeTheme.accentHex
                                : `${activeTheme.accentHex}9E`
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* Chart 2: Peak Activity Times */}
            <section className="lg:col-span-6 glass-card rounded-2xl p-5 flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-hairline">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-accent-strong" />
                  <div>
                    <h2 className="font-display text-base font-semibold text-ink-2">
                      Peak Activity Times
                    </h2>
                    <p className="text-[11px] text-ink-subtle">
                      Posts and engagement rhythm ({localTimezoneLabel})
                    </p>
                  </div>
                </div>

                <div className="inline-flex items-center gap-1 p-1 bg-canvas-alt rounded-lg border border-hairline">
                  <button
                    type="button"
                    onClick={() => setActivityView('hourly')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      activityView === 'hourly'
                        ? 'bg-accent-strong text-accent-fg'
                        : 'text-ink-muted hover:text-ink-2'
                    }`}
                  >
                    24-Hour Cycle
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityView('weekday')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      activityView === 'weekday'
                        ? 'bg-accent-strong text-accent-fg'
                        : 'text-ink-muted hover:text-ink-2'
                    }`}
                  >
                    Day of Week
                  </button>
                </div>
              </div>

              <div className="mt-4 h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {activityView === 'hourly' ? (
                    <AreaChart
                      data={summary.hourlyActivity}
                      margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
                    >
                      <defs>
                        <linearGradient id="goldPostsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={activeTheme.accentHex} stopOpacity={0.38} />
                          <stop offset="95%" stopColor={activeTheme.accentHex} stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="pearlEngagementGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={activeTheme.swatches.text} stopOpacity={0.16} />
                          <stop offset="95%" stopColor={activeTheme.swatches.text} stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke={activeTheme.chartGridColor}
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="shortLabel"
                        interval={2}
                        stroke={activeTheme.chartAxisColor}
                        tick={{ fill: activeTheme.chartAxisColor, fontSize: 11 }}
                        axisLine={{ stroke: activeTheme.chartGridColor }}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        stroke={activeTheme.chartAxisColor}
                        tick={{ fill: activeTheme.chartAxisColor, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ActivityTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="engagement"
                        name="Interactions"
                        stroke={activeTheme.swatches.muted}
                        strokeOpacity={0.75}
                        strokeWidth={1.5}
                        fill="url(#pearlEngagementGradient)"
                      />
                      <Area
                        type="monotone"
                        dataKey="posts"
                        name="Posts"
                        stroke={activeTheme.accentHex}
                        strokeWidth={2.25}
                        fill="url(#goldPostsGradient)"
                        activeDot={{
                          r: 5,
                          fill: activeTheme.accentSoftHex,
                          stroke: activeTheme.swatches.canvas,
                          strokeWidth: 2,
                        }}
                      />
                    </AreaChart>
                  ) : (
                    <BarChart
                      data={summary.weekdayActivity}
                      margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
                    >
                      <CartesianGrid
                        stroke={activeTheme.chartGridColor}
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        stroke={activeTheme.chartAxisColor}
                        tick={{ fill: activeTheme.swatches.text, fontSize: 12 }}
                        axisLine={{ stroke: activeTheme.chartGridColor }}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        stroke={activeTheme.chartAxisColor}
                        tick={{ fill: activeTheme.chartAxisColor, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{
                          fill: activeTheme.isLight
                            ? 'rgba(180, 123, 0, 0.08)'
                            : 'rgba(255, 255, 255, 0.06)',
                        }}
                        content={<ActivityTooltip />}
                      />
                      <Bar
                        dataKey="posts"
                        name="Posts"
                        fill={activeTheme.accentHex}
                        radius={[6, 6, 0, 0]}
                        barSize={24}
                      />
                      <Bar
                        dataKey="engagement"
                        name="Interactions"
                        fill={
                          activeTheme.isLight
                            ? 'rgba(82, 88, 102, 0.28)'
                            : 'rgba(248, 249, 250, 0.25)'
                        }
                        radius={[6, 6, 0, 0]}
                        barSize={24}
                      />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>

              <div className="mt-3 pt-3 border-t border-hairline flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-accent-strong inline-block" />
                    Posts Published
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-ink-muted/50 inline-block" />
                    Likes &amp; Comments
                  </span>
                </div>
                {summary.peakDay && (
                  <span className="font-mono tabular-nums text-accent-strong">
                    Most active day: {summary.peakDay.label} ({summary.peakDay.posts} posts)
                  </span>
                )}
              </div>
            </section>
          </div>

          {/* Detailed Breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Trending Hashtag Leaderboard Table */}
            <section className="lg:col-span-7 glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-hairline flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-accent-strong" />
                  <h2 className="font-display text-base font-semibold text-ink-2">
                    Hashtag Breakdown
                  </h2>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-ink-subtle">
                  Top {summary.topHashtags.length} tags
                </span>
              </div>

              {summary.topHashtags.length === 0 ? (
                <p className="p-6 text-xs text-ink-subtle text-center">
                  No hashtags recorded for the selected filters.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-hairline text-[11px] font-medium text-ink-subtle">
                        <th className="py-3 pl-5 pr-2 w-10">#</th>
                        <th className="py-3 px-3">Hashtag</th>
                        <th className="py-3 px-3 text-right">Posts</th>
                        <th className="py-3 px-3 text-right">Likes</th>
                        <th className="py-3 px-3 text-right">Comments</th>
                        <th className="py-3 pl-3 pr-5 text-right">Feed Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05] text-xs">
                      {summary.topHashtags.map((item, idx) => (
                        <tr
                          key={item.tag}
                          onClick={() => onSearchHashtag(item.tag)}
                          className="hover:bg-hover-tint cursor-pointer transition-colors group"
                        >
                          <td className="py-2.5 pl-5 pr-2 font-mono tabular-nums text-ink-subtle">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-ink-2 group-hover:text-accent-strong flex items-center gap-1.5">
                            <span>{item.label}</span>
                            <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-ink-2">
                            {formatCount(item.posts)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-ink-muted">
                            {formatCount(item.likes)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-ink-muted">
                            {formatCount(item.comments)}
                          </td>
                          <td className="py-2.5 pl-3 pr-5 text-right font-mono tabular-nums text-accent-strong">
                            {item.sharePct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Time-of-Day Windows */}
            <section className="lg:col-span-5 glass-card rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-ink-2">
                  Hostel Activity Windows
                </h2>
                <p className="text-[11px] text-ink-subtle mt-0.5">
                  Share of posts published across each 6-hour window
                </p>

                <div className="mt-5 space-y-4">
                  {summary.dayPeriods.map((period) => (
                    <div key={period.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <span className="font-medium text-ink-2">{period.label}</span>
                          <span className="text-ink-subtle ml-2">{period.range}</span>
                        </div>
                        <span className="font-mono tabular-nums text-ink-muted shrink-0">
                          {period.posts} posts ·{' '}
                          <span className="text-accent-strong font-semibold">{period.pct}%</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-canvas-alt overflow-hidden border border-hairline">
                        <div
                          className="h-full rounded-full bg-accent-strong transition-all duration-300"
                          style={{ width: `${period.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-hairline flex items-center justify-between text-xs text-ink-muted">
                <span>Sampled from latest hostel posts</span>
                <span className="font-mono tabular-nums text-ink-2">
                  {summary.totalPosts} / 100
                </span>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
