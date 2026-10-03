#!/bin/bash

# =============================================================================
# CONFIGURATION - Adjust these values based on your Claude Code settings
# =============================================================================
# Set to true if auto-compact is enabled in Claude Code, false if disabled
AUTO_COMPACT_ENABLED=true

# Auto-compact buffer: roughly max_output_tokens + 20k overhead
# Only used when AUTO_COMPACT_ENABLED=true
# Default max_output = 25k -> buffer = 45k
# If you set max_output = 50k -> buffer ~ 70k
AUTO_COMPACT_BUFFER=33000
# =============================================================================

# Read JSON input
input=$(cat)

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo "Claude Code | Working | -- tokens | Context: [----------] 0%"
    exit 0
fi

# Extract model name
model=$(echo "$input" | jq -r '.model.display_name // .model.id // "Unknown"' 2>/dev/null)
if [[ -z "$model" || "$model" == "null" ]]; then
    model="Claude Code"
fi

# Color code based on model (ANSI color codes)
# Opus = Bright Blue (94), Sonnet = Orange (208), Haiku = Green (32), Unknown = Cyan (36)
model_colored="$model"
if [[ "$model" == *"Opus"* ]] || [[ "$model" == *"opus"* ]]; then
    model_colored="\033[1;94m$model\033[0m"  # Bright blue for Opus
elif [[ "$model" == *"Sonnet"* ]] || [[ "$model" == *"sonnet"* ]]; then
    model_colored="\033[38;5;208m$model\033[0m"  # True orange for Sonnet (256 color)
elif [[ "$model" == *"Haiku"* ]] || [[ "$model" == *"haiku"* ]]; then
    model_colored="\033[1;32m$model\033[0m"  # Green for Haiku
else
    model_colored="\033[1;36m$model\033[0m"  # Cyan for unknown
fi

# Extract thinking effort level (low/medium/high/xhigh/max), absent if unsupported
effort=$(echo "$input" | jq -r '.effort.level // ""' 2>/dev/null)
effort_colored=""
if [[ -n "$effort" ]] && [[ "$effort" != "null" ]]; then
    # Color by intensity: green low, cyan medium, yellow high, orange xhigh, red max
    case "$effort" in
        low)    effort_colored="\033[32m$effort\033[0m" ;;       # Green
        medium) effort_colored="\033[36m$effort\033[0m" ;;       # Cyan
        high)   effort_colored="\033[33m$effort\033[0m" ;;       # Yellow
        xhigh)  effort_colored="\033[38;5;208m$effort\033[0m" ;; # Orange
        max)    effort_colored="\033[31m$effort\033[0m" ;;       # Red
        *)      effort_colored="\033[37m$effort\033[0m" ;;       # Gray fallback
    esac
fi

# Extract current directory (cwd)
current_dir=$(echo "$input" | jq -r '.cwd // .workspace.current_dir // ""' 2>/dev/null)
if [[ -n "$current_dir" ]] && [[ "$current_dir" != "null" ]]; then
    # Convert Windows path to Unix format
    current_dir="${current_dir//\\//}"
    dir_name=$(basename "$current_dir")
else
    dir_name="Working"
fi

# Color current directory in yellow (33)
dir_colored="\033[1;33m$dir_name\033[0m"

# Get git branch if in a git repository
git_branch=""
if [[ -n "$current_dir" ]] && [[ "$current_dir" != "null" ]]; then
    # Try to get git branch (skip optional locks for performance)
    branch=$(cd "$current_dir" 2>/dev/null && git -c core.useReplaceRefs=false branch --show-current 2>/dev/null)
    if [[ -n "$branch" ]]; then
        # Color git branch in cyan (36) with parentheses
        git_branch=" \033[36m($branch)\033[0m"
    fi
fi

# Extract context window data - use current_usage for accurate token count
context_window_size=$(echo "$input" | jq -r '.context_window.context_window_size // 1000000' 2>/dev/null)
current_usage=$(echo "$input" | jq '.context_window.current_usage' 2>/dev/null)

# Effective context limit = context_window_size - buffer (if auto-compact enabled)
if [[ "$AUTO_COMPACT_ENABLED" == "true" ]]; then
    context_size=$((context_window_size - AUTO_COMPACT_BUFFER))
else
    context_size=$context_window_size
fi

# Calculate total tokens used from current_usage (actual context, not cumulative session)
if [[ "$current_usage" != "null" ]] && [[ -n "$current_usage" ]]; then
    input_tokens=$(echo "$current_usage" | jq -r '.input_tokens // 0' 2>/dev/null)
    cache_creation=$(echo "$current_usage" | jq -r '.cache_creation_input_tokens // 0' 2>/dev/null)
    cache_read=$(echo "$current_usage" | jq -r '.cache_read_input_tokens // 0' 2>/dev/null)
    total_used=$((input_tokens + cache_creation + cache_read))
else
    # Fallback if current_usage not available yet
    total_used=0
fi

# Calculate percentage
if [[ $context_size -gt 0 ]]; then
    percentage=$((total_used * 100 / context_size))
else
    percentage=0
fi

# Create progress bar (10 characters wide)
bar_width=10
filled=$((percentage * bar_width / 100))
if [[ $filled -gt $bar_width ]]; then
    filled=$bar_width
fi

# Show at least 1 block if there's any usage
if [[ $filled -eq 0 ]] && [[ $total_used -gt 0 ]]; then
    filled=1
fi

# Build the progress bar
bar=""
for ((i=0; i<bar_width; i++)); do
    if [[ $i -lt $filled ]]; then
        bar="${bar}█"
    else
        bar="${bar}░"
    fi
done

# Color the progress bar based on usage
# Green (32) if < 50%, Yellow (33) if 50-80%, Red (31) if > 80%
if [[ $percentage -lt 50 ]]; then
    bar_colored="\033[32m$bar\033[0m"  # Green
elif [[ $percentage -lt 80 ]]; then
    bar_colored="\033[33m$bar\033[0m"  # Yellow
else
    bar_colored="\033[31m$bar\033[0m"  # Red
fi

# Format tokens in compact k format (e.g., 11.4k, 150k, 1.2k)
format_tokens_compact() {
    local tokens=$1
    if [[ $tokens -ge 1000 ]]; then
        # Convert to thousands with one decimal place
        local k_value=$(awk "BEGIN {printf \"%.1f\", $tokens/1000}")
        # Remove trailing .0 if present
        k_value=$(echo "$k_value" | sed 's/\.0$//')
        echo "${k_value}k"
    else
        echo "${tokens}"
    fi
}

total_used_compact=$(format_tokens_compact "$total_used")

# Output the status line
# Format: Model [effort] | Directory (branch) | Context: XXk [Progress Bar] XX%
# Build optional effort segment (only shown when effort level is available)
effort_segment=""
if [[ -n "$effort_colored" ]]; then
    effort_segment=" $effort_colored"
fi

printf "%b%b | %b%b | Context: %s [%b] %d%%\n" \
    "$model_colored" \
    "$effort_segment" \
    "$dir_colored" \
    "$git_branch" \
    "$total_used_compact" \
    "$bar_colored" \
    "$percentage"