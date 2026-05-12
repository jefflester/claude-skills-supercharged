/**
 * OpenCode Plugin API Verification Test
 * 
 * This test verifies the claims made in the research document about the OpenCode plugin API.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';

// Test suite for verifying OpenCode plugin API claims
describe('OpenCode Plugin API Verification', () => {
  
  // Test 1: Verify plugin paths in opencode.json
  it('Plugin paths in opencode.json', () => {
    const configFile = 'D:/AI/OpenCode/runtime/config/opencode/opencode.json';
    
    // Check if config file exists
    expect(existsSync(configFile)).toBe(true);
    
    // Read config file
    const configContent = readFileSync(configFile, 'utf-8');
    const config = JSON.parse(configContent);
    
    // Verify plugin array exists
    expect(config).toHaveProperty('plugins');
    expect(Array.isArray(config.plugins)).toBe(true);
    
    // NOTE: We won't verify the exact plugin paths since they may vary by installation
  });

  // Test 2: Verify injection mechanisms (system.transform, chat.message)
  it('Injection mechanisms in plugin.ts', () => {
    const pluginFile = 'D:/AI/OpenCode/local-plugins/opencode-agent-skills/src/plugin.ts';
    
    // Check if plugin file exists
    expect(existsSync(pluginFile)).toBe(true);
    
    // Read plugin file
    const pluginContent = readFileSync(pluginFile, 'utf-8');
    
    // Verify system.transform hook registration
    expect(pluginContent).toContain('"experimental.chat.system.transform"');
    
    // Verify chat.message hook registration
    expect(pluginContent).toContain('"chat.message"');
    
    // Verify the hooks are properly exported in the return statement
    expect(pluginContent).toContain('return {');
    expect(pluginContent).toContain('"experimental.chat.system.transform"');
    expect(pluginContent).toContain('"chat.message"');
  });

  // Test 3: Verify tool names in tools.ts
  it('Tool names in tools.ts', () => {
    const toolsFile = 'D:/AI/OpenCode/local-plugins/opencode-agent-skills/src/tools.ts';
    
    // Check if tools file exists
    expect(existsSync(toolsFile)).toBe(true);
    
    // Read tools file
    const toolsContent = readFileSync(toolsFile, 'utf-8');
    
    // Verify all claimed tools are exported
    const expectedTools = [
      'get_available_skills',
      'read_skill_file', 
      'run_skill_script',
      'use_skill'
    ];
    
    expectedTools.forEach(toolName => {
      expect(toolsContent).toContain(toolName);
    });
    
    // Verify tool factory functions exist
    expect(toolsContent).toContain('GetAvailableSkills');
    expect(toolsContent).toContain('ReadSkillFile');
    expect(toolsContent).toContain('RunSkillScript');
    expect(toolsContent).toContain('UseSkill');
  });

  // Test 4: Verify environment variables
  it('Environment variables usage', () => {
    const skillActivationFile = 'D:/AI/Plugins/dynamicskillsinjector/.claude/hooks/skill-activation-prompt.ts';
    
    // Check if skill activation file exists
    expect(existsSync(skillActivationFile)).toBe(true);
    
    // Read skill activation file
    const activationContent = readFileSync(skillActivationFile, 'utf-8');
    
    // Verify CLAUDE_SKILLS_DEBUG is used
    expect(activationContent).toContain('CLAUDE_SKILLS_DEBUG');
    
    // Verify CLAUDE_PROJECT_DIR is used
    expect(activationContent).toContain('CLAUDE_PROJECT_DIR');
    expect(activationContent).toContain('process.env.CLAUDE_PROJECT_DIR || process.cwd()');
  });

  // Test 5: Verify skill directory reading
  it('Skill directory reading in skill-activation-prompt.ts', () => {
    const skillActivationFile = 'D:/AI/Plugins/dynamicskillsinjector/.claude/hooks/skill-activation-prompt.ts';
    
    // Check if file exists
    expect(existsSync(skillActivationFile)).toBe(true);
    
    // Read file content
    const activationContent = readFileSync(skillActivationFile, 'utf-8');
    
    // Verify reading from CLAUDE_PROJECT_DIR/.claude/skills/
    expect(activationContent).toContain("join(projectDir, '.claude', 'skills'");
    expect(activationContent).toContain("const rulesPath = join(projectDir, '.claude', 'skills', 'skill-rules.json')");
  });
});