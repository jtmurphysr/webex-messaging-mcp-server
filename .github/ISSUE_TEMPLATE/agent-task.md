---
name: Agent Task
about: A structured issue for autonomous agent execution
title: ''
labels: agent-task
assignees: ''
---

## Module

<!-- Which module(s) does this issue target? e.g., lib/token-store.js -->

## Specification

<!-- What exactly should be built? Be precise — the agent reads this literally. -->

## Interface Contract

<!-- What does this module export? What do consumers call? -->

```javascript
// Example:
// const store = require('./lib/token-store');
// await store.read();
// await store.write(credentials);
```

## Dependencies

<!-- Which issues must be merged before this one can start? -->

- Depends on: #N (if applicable)

## Domain Warnings

<!-- Copy relevant warnings from AGENTS.md and PRD. Add issue-specific warnings. -->

## Test Cases

<!-- Name the tests. The agent writes the implementations. -->

- [ ] `test: <description>`
- [ ] `test: <description>`

## Out of Scope

<!-- What should the agent NOT do in this issue? -->

## Definition of Done

- [ ] Code matches this specification
- [ ] All existing tests pass (`npm run validate`)
- [ ] New unit tests written and passing
- [ ] No changes to existing tool files
- [ ] PR references this issue (`Closes #N`)
