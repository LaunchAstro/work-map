#!/usr/bin/perl
# Usage: perl ops/hold-lock.pl LOCKFILE WAIT_SECONDS COMMAND...
# Takes the kernel lock (flock) on LOCKFILE, keeps the file open across exec, then becomes COMMAND. The command is
# then the lock holder itself (same process), so the lock lasts exactly as long as the command does, however it
# ends. Exits 75 when the lock is held elsewhere (at once with WAIT 0, else after WAIT seconds).
use strict;
use warnings;
use Fcntl qw(:flock);
$^F = 255; # keep the lock's descriptor open across exec
my $path = shift @ARGV;
my $wait = shift @ARGV;
my $kind = @ARGV && $ARGV[0] eq '--shared' ? (shift @ARGV, LOCK_SH) : LOCK_EX;
open(my $fh, '>>', $path) or die "lock $path: $!";
if ($wait > 0) {
  local $SIG{ALRM} = sub { exit 75 };
  alarm $wait;
  flock($fh, $kind) or exit 75;
  alarm 0;
} else {
  flock($fh, $kind | LOCK_NB) or exit 75;
}
exec @ARGV or die "exec: $!";
