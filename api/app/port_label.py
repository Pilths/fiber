"""Port labels have two shapes (owner decision, 12 Nov 2026):
FDF1-MOD2-T3-P5 is frame 1, module 2, tray 3, port 5; ODF1-P5 is wall frame 1, port 5.
Each part is a number or letters (1 to 4 characters of A-Z and 0-9), so FDF-A-MODB-T3-P5 is also a label.
Typed or pasted text is read leniently (any separator, M or MOD, T or TRAY, P or PORT, a new line from an
Excel cell) and saved in the one canonical form, so the same port is never stored two ways."""
import re
# web/src/lib/portLabel.ts is the small browser twin: it only splits a canonical label into the picker's parts and
# builds one back. This module is the one that reads loose text, so change a rule here first, then there.

LABEL_HELP = "Use FDF1-MOD2-T3-P5 or ODF1-P5 (each part a number or letters)"

_SEPARATOR = re.compile(r"[\s\-_/.,]+")
_VALUE = re.compile(r"[A-Z0-9]{1,4}")
# Each part: the words that may name it, longest first.
_FDF_PARTS = (("FDF",), ("MOD", "M"), ("TRAY", "T"), ("PORT", "P"))
_ODF_PARTS = (("ODF",), ("PORT", "P"))
_CANONICAL_NAMES = {
    "FDF": "FDF", "ODF": "ODF", "MOD": "MOD", "M": "MOD",
    "TRAY": "T", "T": "T", "PORT": "P", "P": "P",
}


def _canonical_value(value: str) -> str | None:
    """A number loses its leading zeros (01 is 1); letters stay; anything else is not a part."""
    if not _VALUE.fullmatch(value):
        return None
    if value.isdigit():
        number = int(value)
        if number < 1:
            return None
        return str(number)
    return value


def _read_part(tokens: list[str], index: int, names: tuple[str, ...]) -> tuple[str, int] | None:
    """The canonical 'NAME+value' text of one part and the next token index, or None."""
    if index >= len(tokens):
        return None
    token = tokens[index]
    for name in names:
        if not token.startswith(name):
            continue
        rest = token[len(name):]
        used = 1
        if not rest:
            if index + 1 >= len(tokens):
                return None
            rest = tokens[index + 1]
            used = 2
        value = _canonical_value(rest)
        if value is None:
            return None
        return _CANONICAL_NAMES[name] + value, index + used
    return None


def _read_parts(tokens: list[str], parts: tuple[tuple[str, ...], ...]) -> list[str] | None:
    index = 0
    texts: list[str] = []
    for names in parts:
        found = _read_part(tokens, index, names)
        if found is None:
            return None
        text, index = found
        texts.append(text)
    if index != len(tokens):
        return None
    return texts


def normalize_port_label(text: str) -> str | None:
    """The canonical label for typed text, or None when the text is not an FDF or ODF port."""
    tokens = [token for token in _SEPARATOR.split(text.strip().upper()) if token]
    if not tokens:
        return None
    if tokens[0].startswith("FDF"):
        parts = _read_parts(tokens, _FDF_PARTS)
    elif tokens[0].startswith("ODF"):
        parts = _read_parts(tokens, _ODF_PARTS)
    else:
        return None
    if parts is None:
        return None
    return "-".join(parts)
