import { describe, expect, test } from 'claude-code/testing'

import {
  COMPOSE_LS_ARGV,
  INFO_ARGV,
  PS_ARGV,
  READ_ONLY_ARGVS,
  STATS_ARGV,
  biggestStacks,
  describeDockerFailure,
  downCommand,
  headroomBytes,
  isComposeUp,
  isReadOnlyArgv,
  markOrphans,
  parseBytes,
  parseLabels,
  parseRecords,
  readInfo,
  readStacks,
  stateLabel,
} from '../hooks/docker'
import { COMPOSE_LS_JSON, GIB, INFO_DAEMON_DOWN, INFO_JSON, PS_LINES, STATS_LINES } from './fixtures'

describe('argv', () => {
  test('the four probes read and never write', () => {
    expect(COMPOSE_LS_ARGV).toEqual(['docker', 'compose', 'ls', '--all', '--format', 'json'])
    expect(STATS_ARGV).toEqual(['docker', 'stats', '--no-stream', '--format', 'json'])
    expect(INFO_ARGV).toEqual(['docker', 'info', '--format', 'json'])
    expect(PS_ARGV).toEqual(['docker', 'ps', '--all', '--no-trunc', '--format', 'json'])
    for (const argv of READ_ONLY_ARGVS) expect(isReadOnlyArgv(argv)).toBe(true)
  })

  test('anything that stops, removes or boots is not read-only', () => {
    for (const argv of [
      ['docker', 'compose', '-p', 'app', 'down'],
      ['docker', 'compose', 'up', '-d'],
      ['docker', 'stop', 'app-web-1'],
      ['docker', 'rm', '-f', 'app-web-1'],
      ['docker', 'kill', 'app-web-1'],
      ['docker', 'system', 'prune', '-f'],
      ['docker', 'stats'],
      ['sh', '-c', 'docker ps'],
    ]) {
      expect(isReadOnlyArgv(argv)).toBe(false)
    }
  })
})

describe('parsing', () => {
  test('records come from a JSON array, one object, or JSON lines', () => {
    expect(parseRecords('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }])
    expect(parseRecords('{"a":1}')).toEqual([{ a: 1 }])
    expect(parseRecords('{"a":1}\n\n{"a":2}\nnot json\n')).toEqual([{ a: 1 }, { a: 2 }])
    expect(parseRecords('')).toEqual([])
  })

  test('sizes in binary and decimal units', () => {
    expect(parseBytes('1.5GiB')).toBe(1.5 * GIB)
    expect(parseBytes('512MiB')).toBe(512 * 1024 ** 2)
    expect(parseBytes('20kB')).toBe(20_000)
    expect(parseBytes('1.2GB')).toBe(1.2e9)
    expect(parseBytes('0B')).toBe(0)
    expect(parseBytes('1.5GiB / 7.654GiB')).toBe(1.5 * GIB)
    expect(parseBytes('--')).toBeNull()
  })

  test('labels split on commas, keeping a comma inside a value', () => {
    expect(parseLabels('a=1,b=/x/y,z,c=3')).toEqual({ a: '1', b: '/x/y,z', c: '3' })
    expect(parseLabels('')).toEqual({})
  })

  test('engine memory from docker info, and a daemon that is down', () => {
    expect(readInfo(INFO_JSON)).toEqual({ totalBytes: 8 * GIB, serverError: null })
    expect(readInfo(INFO_DAEMON_DOWN).serverError).toContain('Cannot connect')
    expect(readInfo('garbage').totalBytes).toBeNull()
  })

  test('compose status reads as a short arcade label', () => {
    expect(stateLabel('running(2)')).toBe('UP 2')
    expect(stateLabel('running(1), exited(1)')).toBe('UP 1 OFF 1')
    expect(stateLabel('exited(3)')).toBe('OFF 3')
    expect(stateLabel('paused(1)')).toBe('PAUSED 1')
    expect(stateLabel('')).toBe('?')
  })
})

describe('stacks', () => {
  const read = () => readStacks(COMPOSE_LS_JSON, PS_LINES, STATS_LINES)

  test('each project gets its working dir from the compose label and the sum of its containers', () => {
    const { stacks } = read()
    const app = stacks.find(stack => stack.name === 'app')
    expect(app).toEqual({
      name: 'app',
      workingDir: '/work/app',
      isOrphan: false,
      stateLabel: 'UP 2',
      isRunning: true,
      containers: 2,
      memoryBytes: 1.5 * GIB + 0.5 * GIB,
    })
    const featureX = stacks.find(stack => stack.name === 'feature-x')
    expect(featureX?.workingDir).toBe('/work/app/.worktrees/feature-x')
    expect(featureX?.memoryBytes).toBe(2.5 * GIB)
    expect(featureX?.containers).toBe(2)
    const api = stacks.find(stack => stack.name === 'api')
    expect(api?.isRunning).toBe(false)
    expect(api?.memoryBytes).toBe(0)
  })

  test('stacks sort biggest first; used memory counts every container, stack or not', () => {
    const { stacks, usedBytes, limitBytes } = read()
    expect(stacks.map(stack => stack.name)).toEqual(['feature-x', 'app', 'api'])
    expect(usedBytes).toBe(5 * GIB)
    expect(Math.abs((limitBytes ?? 0) - 7.654 * GIB)).toBeLessThan(1024)
  })

  test('without a label the working dir falls back to the compose file folder', () => {
    const { stacks } = readStacks(COMPOSE_LS_JSON, '', '')
    expect(stacks.find(stack => stack.name === 'api')?.workingDir).toBe('/work/api')
    expect(stacks.find(stack => stack.name === 'app')?.memoryBytes).toBe(0)
  })

  test('a stats row matches its container by short id when the name differs', () => {
    const stats = JSON.stringify({ ID: 'aaaaaaaaaaaa', Name: 'renamed', MemUsage: '1GiB / 8GiB' })
    const { stacks } = readStacks(COMPOSE_LS_JSON, PS_LINES, stats)
    expect(stacks.find(stack => stack.name === 'app')?.memoryBytes).toBe(GIB)
  })
})

describe('orphans', () => {
  test('a stack whose working dir is gone is an ORPHAN', () => {
    const { stacks } = readStacks(COMPOSE_LS_JSON, PS_LINES, STATS_LINES)
    const marked = markOrphans(stacks, new Set(['/work/app/.worktrees/feature-x']))
    expect(marked.filter(stack => stack.isOrphan).map(stack => stack.name)).toEqual(['feature-x'])
  })

  test('an unknown working dir is never called an orphan', () => {
    const stacks = [{ name: 'x', workingDir: null, isOrphan: false, stateLabel: 'UP 1', isRunning: true, containers: 1, memoryBytes: 0 }]
    expect(markOrphans(stacks, new Set())[0]?.isOrphan).toBe(false)
  })
})

describe('headroom', () => {
  test('headroom is engine total minus everything in use', () => {
    expect(headroomBytes({ totalBytes: 8 * GIB, usedBytes: 5 * GIB })).toBe(3 * GIB)
  })

  test('never negative', () => {
    expect(headroomBytes({ totalBytes: 4 * GIB, usedBytes: 5 * GIB })).toBe(0)
  })

  test('the biggest stacks are the running ones with the most memory', () => {
    const { stacks } = readStacks(COMPOSE_LS_JSON, PS_LINES, STATS_LINES)
    expect(biggestStacks(stacks, 2).map(stack => stack.name)).toEqual(['feature-x', 'app'])
    expect(biggestStacks(stacks, 5).map(stack => stack.name)).not.toContain('api')
  })
})

describe('compose up detection', () => {
  test('matches every way of booting a stack', () => {
    for (const command of [
      'docker compose up',
      'docker compose up -d',
      'docker-compose up -d --build',
      'docker compose -f compose.yaml -p app up -d',
      'docker compose --project-name=app up',
      'cd /work/app && docker compose up -d',
      'sudo docker compose up',
      'docker --context remote compose up',
      'DOCKER_BUILDKIT=1 docker compose --profile dev up -d web',
    ]) {
      expect(isComposeUp(command)).toBe(true)
    }
  })

  test('leaves every other docker command alone', () => {
    for (const command of [
      'docker compose down',
      'docker compose ps',
      'docker compose logs up',
      'docker compose -p up down',
      'docker run up',
      'echo docker compose up',
      'grep "docker compose up" README.md',
      'npm run up',
      '',
    ]) {
      expect(isComposeUp(command)).toBe(false)
    }
  })
})

describe('down command', () => {
  test('is the exact compose command, quoted only when it must be', () => {
    expect(downCommand('feature-x')).toBe('docker compose -p feature-x down')
    expect(downCommand("odd name's")).toBe(`docker compose -p 'odd name'\\''s' down`)
  })
})

describe('failures', () => {
  test('a daemon that is down says so', () => {
    const failure = describeDockerFailure(
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    )
    expect(failure.health).toBe('daemon-down')
  })

  test('anything else keeps its first line', () => {
    const failure = describeDockerFailure("docker: 'compose' is not a docker command.\nSee 'docker --help'")
    expect(failure).toEqual({ health: 'error', message: "docker: 'compose' is not a docker command." })
  })
})
