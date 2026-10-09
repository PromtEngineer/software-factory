Hidden acceptance tests, one per issue in ../issues.json (#10 is deliberately vague and has no test: the right outcome is "needs a human").
Scoring copies these files into a checkout's test/ directory and runs vitest on each. The factory never sees them.
