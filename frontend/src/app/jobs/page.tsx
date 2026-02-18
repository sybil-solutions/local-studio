// CRITICAL
"use client";

import { JobCreateForm } from "@/components/jobs/job-create-form";
import { JobsPanel } from "@/components/jobs/jobs-panel";

export default function JobsPage() {
  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-light tracking-tight">Jobs</h1>
          <p className="text-sm text-foreground/40 mt-1 font-mono">
            Multi-step orchestrated workflows
          </p>
        </div>

        <JobCreateForm />

        <div>
          <h2 className="text-xs uppercase tracking-widest text-foreground/40 mb-3">
            Recent Jobs
          </h2>
          <JobsPanel />
        </div>
      </div>
    </div>
  );
}
