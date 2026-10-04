"""Shared floor assignments, saved with an atomic replace when configured."""

import json
import os
from pathlib import Path
import re
import tempfile


NODE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")


def validate_placement(value):
    if not isinstance(value, dict) or set(value) != {"node_id", "floor"}:
        raise ValueError("Placement must contain node_id and floor")
    if not isinstance(value["node_id"], str) or not NODE_ID.fullmatch(value["node_id"]):
        raise ValueError("Invalid placement node_id")
    floor = value["floor"]
    if floor is not None and (type(floor) is not int or floor not in (1, 2, 3)):
        raise ValueError("floor must be 1, 2, 3 or null")
    return value


class Placements:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else None
        self.assignments = {}
        if self.path is not None and self.path.exists():
            try:
                saved = json.loads(self.path.read_text(encoding="utf-8"))
                if not isinstance(saved, dict):
                    raise ValueError("Expected an object of node IDs and floors")
                for node_id, floor in saved.items():
                    validate_placement({"node_id": node_id, "floor": floor})
                self.assignments = saved
            except (ValueError, UnicodeError) as exc:
                raise ValueError(f"Invalid floor assignments in {self.path}: {exc}") from exc

    def floor(self, node_id):
        if node_id in self.assignments:
            return self.assignments[node_id]
        default = re.fullmatch(r"pi-0*([1-3])", node_id, re.IGNORECASE)
        return int(default[1]) if default else None

    def set(self, node_id, floor):
        validate_placement({"node_id": node_id, "floor": floor})
        updated = {**self.assignments, node_id: floor}
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                                 dir=self.path.parent, delete=False) as stream:
                    temporary = stream.name
                    json.dump(updated, stream, ensure_ascii=True, sort_keys=True, indent=2)
                    stream.write("\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path)
            finally:
                if temporary is not None:
                    Path(temporary).unlink(missing_ok=True)
        self.assignments = updated

    def snapshot(self, node_ids):
        return {node_id: self.floor(node_id)
                for node_id in sorted(set(node_ids) | self.assignments.keys())}
