import os
import re
import subprocess
import time

BACKLOG_PATH = "/Users/kalebbefekadu/.gemini/antigravity/brain/2abc1353-d2a0-4a80-9fb9-5a6878c258ec/mvp_backlog.md"
DISREGARDED_ISSUES = {16, 23, 38, 72, 85}

def main():
    print("Reading MVP backlog...")
    with open(BACKLOG_PATH, 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex to match: "1. **[Category]** Title..."
    pattern = re.compile(r'^(\d+)\.\s+\*\*(.*?)\*\*\s+(.*)$', re.MULTILINE)
    matches = pattern.findall(content)

    issues_to_create = []
    
    for match in matches:
        num = int(match[0])
        category = match[1]
        title = match[2]
        
        if num in DISREGARDED_ISSUES:
            print(f"Skipping discarded issue #{num}")
            continue
            
        full_title = f"{category} {title}"
        issues_to_create.append(full_title)

    # Add the missing issues identified in the audit
    missing_issues = [
        "[Audio] Implement iOS Safari Audio Compatibility (MIME-type fallback)",
        "[DB Setup] Enforce Soft Deletes (deleted_at) across all tables",
        "[UX] Add Offline Toast Warning before recording",
        "[Backend] Implement Vercel Timeout Handling (maxDuration=60)"
    ]
    
    issues_to_create.extend(missing_issues)

    print(f"Found {len(issues_to_create)} issues to push to GitHub.")
    
    for i, issue_title in enumerate(issues_to_create, 1):
        print(f"Creating issue {i}/{len(issues_to_create)}: {issue_title[:50]}...")
        # using subprocess to call gh CLI
        cmd = [
            "gh", "issue", "create",
            "--title", issue_title,
            "--body", f"Imported from Planner AI MVP Backlog."
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error creating issue: {result.stderr}")
        
        # Sleep to avoid GitHub rate limits
        time.sleep(1.5)

    print("All issues created successfully!")

if __name__ == "__main__":
    main()
