-- PDF-only layout. Never modify the source Markdown or other export formats.
-- Keep a useful column width instead of shrinking wide tables into tiny text.
local max_columns = 5
local escaped_chars = {}

function Meta(meta)
  local requested = meta['hebe-pdf-columns'] and tonumber(pandoc.utils.stringify(meta['hebe-pdf-columns']))
  max_columns = math.max(2, math.min(6, math.floor(requested or 5)))
end

local function break_token(text, code)
  if utf8.len(text) < 8 then return nil end
  local parts = {}
  for _, point in utf8.codes(text) do
    local char = utf8.char(point)
    if not escaped_chars[char] then
      if char:match('%s') then
        escaped_chars[char] = '\\ '
      else
        escaped_chars[char] = pandoc.write(pandoc.Pandoc({pandoc.Plain({pandoc.Str(char)})}), 'latex'):gsub('%s+$', '')
      end
    end
    parts[#parts + 1] = escaped_chars[char]
  end
  local latex = table.concat(parts, '\\allowbreak{}')
  if code then latex = '\\texttt{' .. latex .. '}' end
  return pandoc.RawInline('latex', latex)
end

local function rows_of(tbl)
  local rows = {}
  for _, row in ipairs(tbl.head.rows) do rows[#rows + 1] = row end
  for _, body in ipairs(tbl.bodies) do
    for _, row in ipairs(body.head) do rows[#rows + 1] = row end
    for _, row in ipairs(body.body) do rows[#rows + 1] = row end
  end
  for _, row in ipairs(tbl.foot.rows) do rows[#rows + 1] = row end
  return rows
end

function Table(tbl)
  local count = #tbl.colspecs
  if count == 0 then return nil end
  -- Allow long identifiers/URLs to break within cells without dropping characters.
  for _, row in ipairs(rows_of(tbl)) do
    for _, cell in ipairs(row.cells) do
      cell.contents = pandoc.walk_block(pandoc.Div(cell.contents), {
        Str = function(el) return break_token(el.text, false) end,
        Code = function(el) return break_token(el.text, true) end,
      }).content
      if count > max_columns and (cell.col_span ~= 1 or cell.row_span ~= 1) then
        error('PDF: a wide table with merged cells cannot be split safely. Split it into smaller tables before exporting.')
      end
    end
  end

  local result = {}
  local first = 1
  repeat
    local indices = {}
    if first > 1 then indices[#indices + 1] = 1 end
    local last = math.min(count, first + max_columns - #indices - 1)
    for i = first, last do indices[#indices + 1] = i end
    local part = tbl:clone()
    local specs, total = {}, 0
    for _, i in ipairs(indices) do total = total + (tbl.colspecs[i][2] or 0) end
    for _, i in ipairs(indices) do
      local width = total > 0 and (tbl.colspecs[i][2] or 0) / total or 1 / #indices
      specs[#specs + 1] = {tbl.colspecs[i][1], width}
    end
    part.colspecs = specs
    -- Unsliced tables may contain spans; leave their row structure intact.
    if count > max_columns then
      for _, row in ipairs(rows_of(part)) do
        local cells = {}
        for _, i in ipairs(indices) do cells[#cells + 1] = row.cells[i] end
        row.cells = cells
      end
      for _, body in ipairs(part.bodies) do body.row_head_columns = math.min(body.row_head_columns, 1) end
      local label = first == 1 and ('Columns 1–' .. last)
        or ('Columns 1, ' .. first .. '–' .. last)
      result[#result + 1] = pandoc.Para({pandoc.Emph({pandoc.Str(label)})})
      if first > 1 then
        part.identifier = ''
        part.caption = {long = {}}
      end
    end
    result[#result + 1] = part
    first = last + 1
  until first > count
  return result
end

-- Metadata must be read before processing tables.
return {{Meta = Meta}, {Table = Table}}
