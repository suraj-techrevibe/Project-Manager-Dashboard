<?php

namespace App\Services\Pm;

use RuntimeException;

/** Indicates a temporary upstream failure for which a secondary provider may be tried. */
class AiProviderUnavailableException extends RuntimeException
{
}
