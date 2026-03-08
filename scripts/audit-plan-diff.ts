import { diffSchema, PlanDiff } from '../functions/types/diff';

// Mock AI Responses for Scenarios
const SCENARIOS = [
  {
    name: "Stack Change (switch to Railway)",
    updateMessage: "switch to Railway for hosting",
    mockAiResponse: {
      summary: "Updated deployment steps for Railway",
      changes: [
        {
          action: "update_step",
          step_id: "step-deploy-1",
          updates: {
            title: "Configure Railway Project",
            objective: "Set up the project on Railway with connected GitHub repo.",
            suggested_tools: [{ name: "Railway CLI", url: "https://railway.app" }]
          }
        }
      ]
    }
  },
  {
    name: "Scope Addition (add a mobile app)",
    updateMessage: "add a mobile app",
    mockAiResponse: {
      summary: "Added mobile app architecture and development stages",
      changes: [
        {
          action: "add_step",
          stage_id: "stage-architecture",
          step: {
            title: "Mobile App Architecture",
            objective: "Define the React Native or Expo structure.",
            risk_level: "medium"
          }
        }
      ]
    }
  },
  {
    name: "Scope Removal (remove the blog)",
    updateMessage: "remove the blog",
    mockAiResponse: {
      summary: "Removed all blog-related steps",
      changes: [
        {
          action: "remove_step",
          step_id: "step-blog-content"
        },
        {
          action: "remove_step",
          step_id: "step-blog-ui"
        }
      ]
    }
  },
  {
    name: "Safety Violation (remove completed step)",
    updateMessage: "remove everything including done stuff",
    mockAiResponse: {
      summary: "Aggressive removal",
      changes: [
        {
          action: "remove_step",
          step_id: "step-completed-1"
        }
      ]
    }
  }
];

function simulateD1Mutations(diff: PlanDiff, projectId: string) {
  console.log(`\n[Simulating D1 Mutations for: ${diff.summary}]`);
  
  diff.changes.forEach(change => {
    if (change.action === 'update_step') {
      console.log(`SQL: UPDATE steps SET title = '${change.updates.title || 'KEEP'}', is_ai_enriched = 0 WHERE id = '${change.step_id}' AND project_id = '${projectId}'`);
    } else if (change.action === 'add_step') {
      console.log(`SQL: INSERT INTO steps (id, project_id, stage_id, title, is_ai_enriched) VALUES (UUID(), '${projectId}', '${change.stage_id}', '${change.step.title}', 0)`);
    } else if (change.action === 'remove_step') {
      console.log(`SQL: DELETE FROM steps WHERE id = '${change.step_id}' AND project_id = '${projectId}' AND status NOT IN ('complete', 'needs_review')`);
    }
  });
}

async function runAudit() {
  console.log("=== PLAN-DIFF END-TO-END AUDIT ===\n");

  for (const scenario of SCENARIOS) {
    console.log(`--- Scenario: ${scenario.name} ---`);
    console.log(`Input: "${scenario.updateMessage}"`);
    
    // 1. Validate with Zod
    const result = diffSchema.safeParse(scenario.mockAiResponse);
    if (!result.success) {
      console.error("❌ Validation Failed:", result.error.format());
      continue;
    }
    console.log("✅ Zod Validation Passed");

    // 2. Log Raw Response
    console.log("Raw AI Response:", JSON.stringify(scenario.mockAiResponse, null, 2));

    // 3. Simulate Mutations
    simulateD1Mutations(result.data, "test-project-id");
    console.log("\n");
  }
}

runAudit();
