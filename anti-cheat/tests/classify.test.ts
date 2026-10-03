import { describe, expect, test } from 'claude-code/testing'

import { analyzeCommand, classifyCommand } from '../hooks/classify'

describe('classifyCommand', () => {
  const cases: [string, string[]][] = [
    ['pytest -q tests/', ['test']],
    ['uv run pytest -x', ['test']],
    ['npx jest src', ['test']],
    ['pnpm vitest run', ['test']],
    ['go test ./...', ['test']],
    ['cargo test', ['test']],
    ['npm test', ['test']],
    ['yarn run test', ['test']],
    ['bun test', ['test']],
    ['just test', ['test']],
    ['make test', ['test']],
    ['bundle exec rspec', ['test']],
    ['vendor/bin/phpunit', ['test']],
    ['cd app && npm run test -- --watch=false', ['test']],
    ['npx eslint .', ['lint']],
    ['ruff check .', ['lint']],
    ['npx tsc --noEmit', ['lint']],
    ['mypy src', ['lint']],
    ['pyright', ['lint']],
    ['pnpm lint', ['lint']],
    ['npm run typecheck', ['lint']],
    ['npm run build', ['build']],
    ['cargo build --release', ['build']],
    ['go build ./...', ['build']],
    ['gh pr checks 42 --watch', ['ci']],
    ['gh run watch 123', ['ci']],
    ['gh run view 123 --log-failed', ['ci']],
    ['gh api repos/o/r/commits/abc/check-runs', ['ci']],
    ['git push -u origin feat/x', ['push']],
    ['npm run lint && npm test', ['test', 'lint']],
  ]

  for (const [command, checks] of cases) {
    test(command, () => {
      expect(classifyCommand(command).sort()).toEqual([...checks].sort())
    })
  }

  test('ordinary commands are not checks', () => {
    for (const command of ['ls -la', 'git status', 'cat package.json', 'npm install', 'echo test', 'grep -r pytest .', 'git commit -m "add tests"']) {
      expect(classifyCommand(command), command).toEqual([])
    }
  })

  test('installing a tool is not running it', () => {
    for (const command of [
      'npm install -D eslint jest',
      'npm i -D vitest',
      'pnpm add -D vitest eslint',
      'yarn add --dev jest',
      'bun add -d eslint',
      'pip install pytest mypy',
      'pip3 install ruff',
      'python -m pip install pytest',
      'uv pip install pytest',
      'uv add --dev pytest ruff',
      'uv tool install ruff',
      'poetry add --group dev pytest',
      'cargo install cargo-nextest',
      'brew install ruff',
      'pipx install mypy',
    ]) {
      expect(classifyCommand(command), command).toEqual([])
    }
    expect(classifyCommand('pip install pytest && pytest -q')).toEqual(['test'])
  })
})

describe('analyzeCommand', () => {
  const statusOf = (command: string) => analyzeCommand(command).status

  test('a plain check reports through its exit status', () => {
    expect(statusOf('pytest -q')).toEqual({ test: 'exit' })
    expect(statusOf('cd app && npm test')).toEqual({ test: 'exit' })
    expect(statusOf('npm test 2>&1')).toEqual({ test: 'exit' })
    expect(statusOf('npm run lint && npm test')).toEqual({ test: 'exit', lint: 'exit' })
    expect(statusOf('pytest;')).toEqual({ test: 'exit' })
    expect(statusOf('pytest && echo ok | tail -1')).toEqual({ test: 'exit' })
  })

  test('a pipe, || or a later command hides the exit status', () => {
    expect(statusOf('pytest 2>&1 | tail -20')).toEqual({ test: 'masked' })
    expect(statusOf('npx vitest run | tee out.log')).toEqual({ test: 'masked' })
    expect(statusOf('npm test |& tail')).toEqual({ test: 'masked' })
    expect(statusOf('npm test || true')).toEqual({ test: 'masked' })
    expect(statusOf('pytest || :')).toEqual({ test: 'masked' })
    expect(statusOf('pytest; true')).toEqual({ test: 'masked' })
    expect(statusOf('pytest; echo done')).toEqual({ test: 'masked' })
    expect(statusOf('pytest\necho done')).toEqual({ test: 'masked' })
    expect(statusOf('pytest && echo ok || echo bad')).toEqual({ test: 'masked' })
    expect(statusOf('npm run lint; npm test')).toEqual({ lint: 'masked', test: 'exit' })
  })

  test('pipefail keeps a pipe honest, set -e keeps ; honest', () => {
    expect(statusOf('set -o pipefail; pytest 2>&1 | tail -20')).toEqual({ test: 'exit' })
    expect(statusOf('set -euo pipefail\npytest | tail')).toEqual({ test: 'exit' })
    expect(statusOf('set -e; pytest; echo done')).toEqual({ test: 'exit' })
    expect(statusOf('set -o pipefail; pytest | tail || true')).toEqual({ test: 'masked' })
  })

  test('only some CI queries exit with the CI result', () => {
    expect(statusOf('gh pr checks 42 --watch')).toEqual({ ci: 'exit' })
    expect(statusOf('gh run watch 123 --exit-status')).toEqual({ ci: 'exit' })
    expect(statusOf('gh run view 123 --exit-status')).toEqual({ ci: 'exit' })
    expect(statusOf('gh run view 123')).toEqual({ ci: 'read' })
    expect(statusOf('gh run watch 123')).toEqual({ ci: 'read' })
    expect(statusOf('gh api repos/o/r/commits/abc/check-runs')).toEqual({ ci: 'read' })
    expect(statusOf('gh pr view 42 --json statusCheckRollup')).toEqual({ ci: 'read' })
    expect(statusOf('gh run view 123; gh pr checks 42')).toEqual({ ci: 'exit' })
    expect(statusOf('gh pr checks 42 || true')).toEqual({ ci: 'masked' })
  })
})
