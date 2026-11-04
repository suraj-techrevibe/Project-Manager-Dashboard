<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PmBusiness extends Model
{
    protected $guarded = [];

    public function projectLinks(): HasMany
    {
        return $this->hasMany(PmBusinessProjectLink::class, 'business_id');
    }

    public function intakes(): HasMany
    {
        return $this->hasMany(PmIntake::class, 'business_id');
    }
}
