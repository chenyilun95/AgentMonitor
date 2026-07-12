---
name: code-review
description: "This skill should be used when the user asks to review code, check code quality, find security issues, or audit a codebase for best practices."
---

# Code Review

When reviewing code, follow these steps:

1. **Security**: Check for injection vulnerabilities, hardcoded secrets, unsafe deserialization, and OWASP top 10 issues
2. **Error handling**: Verify proper error propagation, missing null checks, and unhandled promise rejections
3. **Performance**: Identify N+1 queries, unnecessary re-renders, missing indexes, and unbounded loops
4. **Code quality**: Look for dead code, duplicated logic, overly complex functions, and naming inconsistencies
5. **Testing**: Note missing test coverage for critical paths

Report findings grouped by severity (critical, warning, suggestion).
