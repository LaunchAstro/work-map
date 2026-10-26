import type { ReactNode } from 'react';
import type { VersionsSnapshot } from '../core/versions.ts';
import { shortStamp } from './words.ts';
import { CalloutGroup, HeaderCallout } from './Callout.tsx';
import { readOnce } from '../core/freshness.ts';

export function SiteVersions({
  data,
  failed: stale,
}: {
  readonly data: VersionsSnapshot | null;
  readonly failed: boolean;
}): ReactNode {
  if (!data)
    return (
      <HeaderCallout
        button="Site versions"
        label="Served site versions"
        title="Site versions"
        snapshot="Site version read pending"
      >
        <p>Site versions unavailable for this map.</p>
      </HeaderCallout>
    );
  if (!data.sites.length && !data.error) return null;
  // Versions are read on Sync only (#245), so between Syncs the last read stands with its time;
  // only a failed browser read is stale.
  const read = readOnce(data.checkedAt, Date.now());
  const commitUrl = (sha: string): string => `https://github.com/${data.repo}/commit/${sha}`;
  return (
    <HeaderCallout
      button="Site versions"
      label="Served site versions"
      title="Site versions"
      snapshot={`Checked ${shortStamp(data.checkedAt)} · ${stale ? 'Stale' : !read || data.error || data.sites.some((site) => site.state !== 'current') ? 'Pending' : 'Verified'}`}
    >
      <div className="brief-groups">
        <span>
          Main{' '}
          {data.main ? (
            <a href={commitUrl(data.main)} target="_blank" rel="noreferrer">
              {data.main.slice(0, 12)}
            </a>
          ) : (
            'pending'
          )}
        </span>
        {data.error && <strong>{data.error}</strong>}
        {data.sites.map((site) => (
          <CalloutGroup key={site.origin} title={site.name}>
            <div className="brief-row">
              <a href={site.origin} target="_blank" rel="noreferrer">
                {site.origin}
              </a>
              <span>
                Served{' '}
                {site.sha && site.build ? (
                  <a href={commitUrl(site.sha)} target="_blank" rel="noreferrer">
                    {site.build}
                  </a>
                ) : (
                  (site.build ?? 'pending')
                )}
              </span>
              <strong>
                {!stale && read && site.state === 'current'
                  ? `${site.merges} ${site.merges === 1 ? 'merge' : 'merges'} not live`
                  : 'Merge distance pending'}
              </strong>
              <a href={site.buildUrl} target="_blank" rel="noreferrer" title={site.reason}>
                Build evidence
              </a>
              {site.state === 'pending' && (
                <small>
                  {site.reason}
                  {site.lastKnown
                    ? ` · Last verified ${site.lastKnown.merges} merges at ${shortStamp(site.lastKnown.at)}`
                    : ''}
                </small>
              )}
              <small>
                {stale ? 'Stale · ' : 'Checked '}
                {shortStamp(data.checkedAt)}
              </small>
            </div>
          </CalloutGroup>
        ))}
      </div>
    </HeaderCallout>
  );
}
