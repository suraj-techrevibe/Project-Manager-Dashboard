<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class UserSeeder extends Seeder
{
    public function run(): void
    {
        User::firstOrCreate(
            ['email' => 'suraj.techrevibe@gmail.com'],
            [
                'name' => 'Suraj Shrestha',
                'password' => Hash::make('Shinig@mi1716'),
                'email_verified_at' => now(),
            ]
        );
    }
}
