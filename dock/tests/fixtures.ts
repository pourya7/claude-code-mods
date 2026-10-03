// Docker output as the CLI prints it, for a machine with three compose stacks:
// `app` (this worktree), `feature-x` (its worktree was deleted) and `api`
// (stopped), plus one plain container that belongs to no stack.

export const GIB = 1024 ** 3

export const INFO_JSON = JSON.stringify({ ServerVersion: '27.3.1', MemTotal: 8 * GIB, NCPU: 8 })

export const INFO_DAEMON_DOWN = JSON.stringify({
  ServerErrors: ['Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'],
})

export const COMPOSE_LS_JSON = JSON.stringify([
  { Name: 'app', Status: 'running(2)', ConfigFiles: '/work/app/compose.yaml' },
  { Name: 'feature-x', Status: 'running(1), exited(1)', ConfigFiles: '/work/app/.worktrees/feature-x/compose.yaml' },
  { Name: 'api', Status: 'exited(2)', ConfigFiles: '/work/api/docker-compose.yml' },
])

const labels = (project: string, dir: string, service: string) =>
  [
    `com.docker.compose.config-hash=abc`,
    `com.docker.compose.project=${project}`,
    `com.docker.compose.project.working_dir=${dir}`,
    `com.docker.compose.service=${service}`,
  ].join(',')

/** `docker ps --all --no-trunc --format json`: one JSON object per line. */
export const PS_LINES = [
  { ID: 'aaaaaaaaaaaa1111', Names: 'app-web-1', State: 'running', Labels: labels('app', '/work/app', 'web') },
  { ID: 'bbbbbbbbbbbb2222', Names: 'app-db-1', State: 'running', Labels: labels('app', '/work/app', 'db') },
  {
    ID: 'cccccccccccc3333',
    Names: 'feature-x-web-1',
    State: 'running',
    Labels: labels('feature-x', '/work/app/.worktrees/feature-x', 'web'),
  },
  {
    ID: 'dddddddddddd4444',
    Names: 'feature-x-db-1',
    State: 'exited',
    Labels: labels('feature-x', '/work/app/.worktrees/feature-x', 'db'),
  },
  { ID: 'eeeeeeeeeeee5555', Names: 'api-web-1', State: 'exited', Labels: labels('api', '/work/api', 'web') },
  { ID: 'ffffffffffff6666', Names: 'scratch', State: 'running', Labels: '' },
]
  .map(line => JSON.stringify(line))
  .join('\n')

/** `docker stats --no-stream --format json`: running containers only, short ids. */
export const STATS_LINES = [
  { ID: 'aaaaaaaaaaaa', Name: 'app-web-1', MemUsage: '1.5GiB / 7.654GiB', MemPerc: '19.60%' },
  { ID: 'bbbbbbbbbbbb', Name: 'app-db-1', MemUsage: '512MiB / 7.654GiB', MemPerc: '6.53%' },
  { ID: 'cccccccccccc', Name: 'feature-x-web-1', MemUsage: '2.5GiB / 7.654GiB', MemPerc: '32.66%' },
  { ID: 'ffffffffffff', Name: 'scratch', MemUsage: '512MiB / 7.654GiB', MemPerc: '6.53%' },
]
  .map(line => JSON.stringify(line))
  .join('\n')

/** Directories that still exist on disk: feature-x's worktree is gone. */
export const EXISTING_DIRS = ['/work/app', '/work/api']
