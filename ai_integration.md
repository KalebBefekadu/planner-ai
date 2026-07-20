# AI Integration

## 1. OpenAI Whisper Integration
* **Purpose:** Frictionless voice-to-text capture.
* **MVP Implementation:** The user records audio via the browser's MediaRecorder API. The audio blob is sent to a secure Next.js API route, which forwards it to the OpenAI Whisper API. The resulting transcript is returned and saved as raw text in the database.

## 2. Strategic Coach (LLM)
* **MVP Implementation:** 
    * **Vision Casting:** The UI provides an expandable text area for the user to write. Below it, the LLM generates Socratic questions based on what is currently written to provoke deeper thought.
    * **SMART Goal Suggestions:** When a user creates a goal, the LLM can offer a "suggested improvement" if the goal is vague. The user retains full control and can choose to ignore the AI and save their original text.

## 3. Future Enhancements (Post-MVP)
* **Automated Progress Analyzer:** The LLM actively consumes raw voice transcripts and automatically updates task statuses, extracting blockers.
* **Aggressive Enforcement:** Preventing the saving of non-SMART goals.
