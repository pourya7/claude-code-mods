import { describe, expect, test } from 'claude-code/testing'

import { denyText, sleepPollShape } from '../hooks/poll'

describe('sleepPollShape', () => {
  test('sleep N with N >= 20', () => {
    expect(sleepPollShape('sleep 20')).not.toBeNull()
    expect(sleepPollShape('sleep 300 && gh pr view 12')).not.toBeNull()
    expect(sleepPollShape('sleep 1m')).not.toBeNull()
    expect(sleepPollShape('sleep 19')).toBeNull()
    expect(sleepPollShape('sleep 2; ls')).toBeNull()
  })

  test('gh pr checks --watch and gh run watch', () => {
    expect(sleepPollShape('gh pr checks 12 --watch')).not.toBeNull()
    expect(sleepPollShape('gh pr checks --watch --interval 30')).not.toBeNull()
    expect(sleepPollShape('gh run watch 123456')).not.toBeNull()
    expect(sleepPollShape('gh pr checks 12')).toBeNull()
    expect(sleepPollShape('gh run view 123456')).toBeNull()
  })

  test('until / while loops that call gh', () => {
    expect(sleepPollShape('until gh pr checks 12; do sleep 5; done')).not.toBeNull()
    expect(sleepPollShape('while true; do gh run list; sleep 10; done')).not.toBeNull()
    expect(sleepPollShape('while read line; do echo $line; done < f')).toBeNull()
  })

  test('ordinary commands pass', () => {
    expect(sleepPollShape('npm test')).toBeNull()
  })

  test('words inside quoted messages and titles never match', () => {
    expect(sleepPollShape('git commit -m "fix crash while loading" && git push && gh pr create --fill')).toBeNull()
    expect(sleepPollShape('git commit -m "retry: sleep 30 between attempts"')).toBeNull()
    expect(sleepPollShape("git commit -m 'Cut the retry sleep 30 to 5'")).toBeNull()
    expect(sleepPollShape('gh pr create --title "Retry until gh api stops rate limiting"')).toBeNull()
    expect(sleepPollShape("echo $'wait while gh runs; done'")).toBeNull()
    expect(sleepPollShape('echo "gh run watch is slow"')).toBeNull()
  })

  test('sleep only counts at command position', () => {
    expect(sleepPollShape('man sleep 30')).toBeNull()
    expect(sleepPollShape('echo hi; sleep 30')).not.toBeNull()
    expect(sleepPollShape('true || sleep 30')).not.toBeNull()
    expect(sleepPollShape('for i in 1 2; do sleep 45; done')).not.toBeNull()
    expect(sleepPollShape('(sleep 60; gh pr view 12)')).not.toBeNull()
  })

  test('a loop counts only when gh runs inside it', () => {
    expect(sleepPollShape('while read f; do echo "$f"; done < list.txt; gh pr view 12')).toBeNull()
    expect(sleepPollShape('cat x | while read f; do echo $f; done && gh pr view 12')).toBeNull()
    expect(sleepPollShape('x=1; while [ $x -lt 9 ]; do gh pr view 12; x=$((x+1)); done')).not.toBeNull()
  })
})

describe('denyText', () => {
  test('names the watched PRs', () => {
    expect(denyText([12])).toBe('sentry is watching PR #12 and will wake you; end your turn instead.')
    expect(denyText([12, 14])).toBe('sentry is watching PR #12, #14 and will wake you; end your turn instead.')
  })
})
