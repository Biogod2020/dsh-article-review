# DSH native parallel dispatch

Read the available tool schema. Prefer fresh subagent runs over forking a long conversation. Keep the configured model and permissions. Each worker starts with `paper_open`, loads this skill if needed, and reads the shared packet. Assign one writer per figure and disjoint temporary paths.

DSH workflow documents `agent(prompt,opts)`, `parallel(thunks)` and `args`. A bounded queue avoids launching the whole paper at once:

```javascript
const jobs = args.jobs;
let next = 0;
async function worker() {
  const results = [];
  while (next < jobs.length) {
    const job = jobs[next++];
    const result = await agent(job.prompt, {label: job.figure});
    results.push({figure: job.figure, result});
  }
  return results;
}
return (await parallel(Array.from({length: Math.min(3, jobs.length)}, () => () => worker()))).flat();
```

Worker prompts contain only manuscript/workspace path, packet path, assigned figure/source, its work directory, skill path, and the end state: inspect → prepare → view crops → register → compact report. Preserve other figures and original files. Children do not delegate further by default.

A null or refused result is unfinished. Handle that figure, keeping successful maps. If delegation is unavailable/capped, continue sequentially without changing settings. The parent verifies saved-label totals with `paper_figure_list`; it does not reload every paragraph and full map.
