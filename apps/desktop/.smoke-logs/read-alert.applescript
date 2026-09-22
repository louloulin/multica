tell application "System Events"
  tell process "Lumen"
    set winList to every window
    set out to ""
    repeat with w in winList
      set wname to name of w
      set out to out & "WIN=" & wname & "|"
      try
        set stList to every static text of w
        repeat with stItem in stList
          set out to out & (value of stItem) & "||"
        end repeat
      end try
    end repeat
    return out
  end tell
end tell