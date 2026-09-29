       fd   master-file.

       01   master-rec.
            03 master-key                pic 9(03).
            03 master-name               pic x(20).
            03 master-flag               pic x(01).
               88 master-active               value "A".
