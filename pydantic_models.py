from __future__ import annotations

from typing import Any, Dict, List, Literal

from pydantic import BaseModel, Field, field_validator


AccessLevel = Literal["viewer", "developer", "contributor", "maintainer", "admin"]


class PlanSystem(BaseModel):
    name: str
    access_level: AccessLevel
    fields_to_provision: Dict[str, Any]


class ProvisioningPlan(BaseModel):
    systems: List[PlanSystem]
    buddy: str = Field(min_length=1)
    orientation_slots: List[str]
    welcome_pack: str
    compliance_attestations: List[str]
    plan_rationale: str

    @field_validator("orientation_slots")
    @classmethod
    def validate_orientation_slots(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("orientation_slots must be non-empty")
        return value


# Prompt typo compatibility: keep alias so existing imports continue to work.
ProvisioingPlan = ProvisioningPlan
